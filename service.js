const fs = require("node:fs");
const http = require("node:http");
const crypto = require("node:crypto");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const tls = require("node:tls");
const { URL } = require("node:url");

const root = __dirname;
const configPath = path.join(root, "config.json");
const fallbackConfigPath = path.join(root, "config.example.json");
const logPath = path.join(root, "service.log");
const envPath = path.join(root, ".env");
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
};

function loadEnvFile() {
  if (!fs.existsSync(envPath)) {
    return;
  }
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }
    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function loadConfig() {
  const source = fs.existsSync(configPath) ? configPath : fallbackConfigPath;
  return JSON.parse(fs.readFileSync(source, "utf8"));
}

loadEnvFile();
let config = loadConfig();
const host = config.host || "127.0.0.1";
const port = Number(config.port || 8765);

function log(entry) {
  const line = `${new Date().toISOString()} ${entry}\n`;
  fs.appendFile(logPath, line, () => {});
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });
    req.on("error", reject);
  });
}

function publicDevice(device) {
  return {
    id: device.id,
    name: device.name,
    type: device.type,
    provider: device.provider,
    defaultTemperatureCelsius: device.defaultTemperatureCelsius,
  };
}

function findDevice(id) {
  return (config.devices || []).find((device) => device.id === id);
}

function localNetworkDefaults() {
  const interfaces = os.networkInterfaces();
  const networks = [];
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family !== "IPv4" || entry.internal) {
        continue;
      }
      const parts = entry.address.split(".");
      if (parts.length === 4) {
        networks.push({
          address: entry.address,
          subnet: `${parts[0]}.${parts[1]}.${parts[2]}`,
        });
      }
    }
  }
  return networks;
}

function probePort(hostname, probePort, timeoutMs = 450) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (open) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(probePort, hostname);
  });
}

async function probeHttp(hostname, probePort) {
  if (![80, 443, 8080, 8888, 8000].includes(probePort)) {
    return null;
  }
  const protocol = probePort === 443 ? "https" : "http";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 850);
  try {
    const response = await fetch(`${protocol}://${hostname}:${probePort}/`, {
      method: "GET",
      signal: controller.signal,
    });
    const text = await response.text();
    const title = text.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();
    return {
      status: response.status,
      server: response.headers.get("server") || "",
      title: title || "",
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function scanLan(options = {}) {
  const networks = localNetworkDefaults();
  const subnet = options.subnet || networks[0]?.subnet;
  if (!subnet || !/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(subnet)) {
    throw new Error("No IPv4 subnet found. Pass subnet like 192.168.1.");
  }

  const ports = Array.isArray(options.ports) && options.ports.length
    ? options.ports.map(Number).filter((item) => Number.isInteger(item) && item > 0 && item < 65536)
    : [80, 443, 8080, 8888, 8000, 6668, 6669, 1883];
  const from = Math.max(1, Number(options.from || 1));
  const to = Math.min(254, Number(options.to || 254));
  const concurrency = Math.max(1, Math.min(48, Number(options.concurrency || 32)));
  const hosts = [];
  for (let index = from; index <= to; index += 1) {
    hosts.push(`${subnet}.${index}`);
  }

  const results = [];
  let cursor = 0;
  async function worker() {
    while (cursor < hosts.length) {
      const hostname = hosts[cursor];
      cursor += 1;
      const openPorts = [];
      for (const probe of ports) {
        if (await probePort(hostname, probe)) {
          openPorts.push({
            port: probe,
            http: await probeHttp(hostname, probe),
          });
        }
      }
      if (openPorts.length) {
        results.push({ host: hostname, ports: openPorts });
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  results.sort((a, b) => a.host.localeCompare(b.host, undefined, { numeric: true }));
  return { subnet, ports, results };
}

function interpolate(value, context) {
  if (typeof value !== "string") {
    return value;
  }
  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name) => {
    if (name === "VALUE") {
      return context.value ?? "";
    }
    if (name === "COMMAND") {
      return context.command ?? "";
    }
    if (name === "DEVICE_ID") {
      return context.device?.id ?? "";
    }
    if (name === "THING_ID") {
      return context.provider?.thingId ?? "";
    }
    return process.env[name] || "";
  });
}

function interpolateObject(value, context) {
  if (value === "${VALUE_NUMBER}") {
    const numberValue = Number(context.value);
    if (!Number.isFinite(numberValue)) {
      throw new Error("Command value must be a number.");
    }
    return numberValue;
  }
  if (value === "${VALUE_FIXED1}") {
    const numberValue = Number(context.value);
    if (!Number.isFinite(numberValue)) {
      throw new Error("Command value must be a number.");
    }
    return numberValue.toFixed(1);
  }
  if (typeof value === "string") {
    return interpolate(value, context);
  }
  if (Array.isArray(value)) {
    return value.map((item) => interpolateObject(item, context));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, interpolateObject(item, context)]),
    );
  }
  return value;
}

async function postJson(url, payload, headers = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let body = text;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {}
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
  }
  return body;
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hmac(key, value, encoding) {
  return crypto.createHmac("sha256", key).update(value).digest(encoding);
}

function awsSignatureKey(secretAccessKey, dateStamp, region, service) {
  const dateKey = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, service);
  return hmac(serviceKey, "aws4_request");
}

function awsUriEncode(value) {
  return encodeURIComponent(value)
    .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function awsCanonicalQuery(params) {
  return Object.entries(params)
    .map(([key, value]) => [awsUriEncode(key), awsUriEncode(String(value))])
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => (
      leftKey === rightKey ? leftValue.localeCompare(rightValue) : leftKey.localeCompare(rightKey)
    ))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

async function awsSignedFetch({ method, endpoint, region, service, pathName, query = "", payload = "", headers = {}, credentials = {} }) {
  const accessKeyId = credentials.accessKeyId || process.env.BLUESTAR_AWS_ACCESS_KEY_ID;
  const secretAccessKey = credentials.secretAccessKey || process.env.BLUESTAR_AWS_SECRET_ACCESS_KEY;
  const sessionToken = credentials.sessionToken || process.env.BLUESTAR_AWS_SESSION_TOKEN;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("Blue Star AWS credentials are missing. Set BLUESTAR_AWS_ACCESS_KEY_ID and BLUESTAR_AWS_SECRET_ACCESS_KEY.");
  }

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(payload);
  const requestHeaders = {
    host: endpoint,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...headers,
  };
  if (sessionToken) {
    requestHeaders["x-amz-security-token"] = sessionToken;
  }

  const signedHeaderNames = Object.keys(requestHeaders)
    .map((name) => name.toLowerCase())
    .sort();
  const canonicalHeaders = signedHeaderNames
    .map((name) => `${name}:${String(requestHeaders[name]).trim()}\n`)
    .join("");
  const canonicalRequest = [
    method,
    pathName,
    query,
    canonicalHeaders,
    signedHeaderNames.join(";"),
    payloadHash,
  ].join("\n");
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signature = hmac(awsSignatureKey(secretAccessKey, dateStamp, region, service), stringToSign, "hex");
  requestHeaders.Authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaderNames.join(";")}, Signature=${signature}`;

  const response = await fetch(`https://${endpoint}${pathName}${query ? `?${query}` : ""}`, {
    method,
    headers: requestHeaders,
    body: payload,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`AWS IoT publish failed with HTTP ${response.status}: ${text}`);
  }
  return text ? { response: text } : {};
}

function awsPresignedUrl({ endpoint, region, service, pathName, credentials = {}, expires, port, signHostWithPort }) {
  const accessKeyId = (credentials.accessKeyId || process.env.BLUESTAR_AWS_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = (credentials.secretAccessKey || process.env.BLUESTAR_AWS_SECRET_ACCESS_KEY || "").trim();
  const sessionToken = (credentials.sessionToken || process.env.BLUESTAR_AWS_SESSION_TOKEN || "").trim();
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("AWS credentials are missing for presigned URL.");
  }

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const signedHost = signHostWithPort && port ? `${endpoint}:${port}` : endpoint;
  const params = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${accessKeyId}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-SignedHeaders": "host",
  };
  if (expires !== false) {
    params["X-Amz-Expires"] = String(expires === true || expires === undefined ? 900 : Number(expires));
  }
  const canonicalQuery = awsCanonicalQuery(params);
  const payloadHash = sha256Hex("");
  const canonicalRequest = [
    "GET",
    pathName,
    canonicalQuery,
    `host:${signedHost}\n`,
    "host",
    payloadHash,
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signature = hmac(awsSignatureKey(secretAccessKey, dateStamp, region, service), stringToSign, "hex");
  const tokenQuery = sessionToken ? `&X-Amz-Security-Token=${awsUriEncode(sessionToken)}` : "";
  return `wss://${endpoint}${port ? `:${port}` : ""}${pathName}?${canonicalQuery}&X-Amz-Signature=${signature}${tokenQuery}`;
}

function mqttString(value) {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length > 65535) {
    throw new Error("MQTT string is too long.");
  }
  return Buffer.concat([Buffer.from([bytes.length >> 8, bytes.length & 0xff]), bytes]);
}

function mqttRemainingLength(length) {
  const bytes = [];
  do {
    let encoded = length % 128;
    length = Math.floor(length / 128);
    if (length > 0) {
      encoded |= 128;
    }
    bytes.push(encoded);
  } while (length > 0);
  return Buffer.from(bytes);
}

function mqttPacket(packetType, payload) {
  return Buffer.concat([Buffer.from([packetType]), mqttRemainingLength(payload.length), payload]);
}

function mqttConnectPacket(clientId) {
  const variableHeader = Buffer.concat([
    mqttString("MQTT"),
    Buffer.from([4, 2, 0, 30]),
  ]);
  return mqttPacket(0x10, Buffer.concat([variableHeader, mqttString(clientId)]));
}

function mqttPublishPacket(topic, message) {
  const payload = Buffer.from(message, "utf8");
  return mqttPacket(0x30, Buffer.concat([mqttString(topic), payload]));
}

function mqttSubscribePacket(packetId, topic, qos = 1) {
  const variableHeader = Buffer.from([packetId >> 8, packetId & 0xff]);
  const payload = Buffer.concat([mqttString(topic), Buffer.from([qos])]);
  return mqttPacket(0x82, Buffer.concat([variableHeader, payload]));
}

function mqttDisconnectPacket() {
  return Buffer.from([0xe0, 0x00]);
}

function webSocketFrame(payload) {
  const bytes = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const lengthBytes = [];
  if (bytes.length < 126) {
    lengthBytes.push(0x80 | bytes.length);
  } else if (bytes.length <= 0xffff) {
    lengthBytes.push(0x80 | 126, bytes.length >> 8, bytes.length & 0xff);
  } else {
    const lengthBuffer = Buffer.alloc(8);
    lengthBuffer.writeBigUInt64BE(BigInt(bytes.length));
    lengthBytes.push(0x80 | 127, ...lengthBuffer);
  }
  const mask = crypto.randomBytes(4);
  const masked = Buffer.alloc(bytes.length);
  for (let index = 0; index < bytes.length; index += 1) {
    masked[index] = bytes[index] ^ mask[index % 4];
  }
  return Buffer.concat([Buffer.from([0x82, ...lengthBytes]), mask, masked]);
}

function parseWebSocketFrame(buffer) {
  if (buffer.length < 2) {
    return null;
  }
  const opcode = buffer[0] & 0x0f;
  const masked = (buffer[1] & 0x80) !== 0;
  let length = buffer[1] & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < offset + 2) {
      return null;
    }
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buffer.length < offset + 8) {
      return null;
    }
    const bigLength = buffer.readBigUInt64BE(offset);
    if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("WebSocket frame is too large.");
    }
    length = Number(bigLength);
    offset += 8;
  }
  let mask;
  if (masked) {
    if (buffer.length < offset + 4) {
      return null;
    }
    mask = buffer.subarray(offset, offset + 4);
    offset += 4;
  }
  if (buffer.length < offset + length) {
    return null;
  }
  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (mask) {
    for (let index = 0; index < payload.length; index += 1) {
      payload[index] ^= mask[index % 4];
    }
  }
  return {
    opcode,
    payload,
    rest: buffer.subarray(offset + length),
  };
}

function readUntil(socket, predicate, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    let settled = false;
    const timeout = setTimeout(() => finish(new Error(`${label} timed out.`)), timeoutMs);
    const finish = (error, value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onClose);
      if (error) {
        reject(error);
        return;
      }
      resolve(value);
    };
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      try {
        const value = predicate(buffer);
        if (value) {
          finish(null, value);
        }
      } catch (error) {
        finish(error);
      }
    };
    const onError = (error) => finish(error);
    const onClose = () => finish(new Error(`${label} closed early.`));
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
}

async function openRawWebSocket(url, protocol) {
  const parsed = new URL(url);
  const key = crypto.randomBytes(16).toString("base64");
  const socket = tls.connect({
    host: parsed.hostname,
    port: Number(parsed.port || 443),
    servername: parsed.hostname,
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("TLS connection timed out.")), 10000);
    socket.once("secureConnect", () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });

  const requestTarget = `${parsed.pathname}${parsed.search}`;
  socket.write([
    `GET ${requestTarget} HTTP/1.1`,
    `Host: ${parsed.host}`,
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Key: ${key}`,
    "Sec-WebSocket-Version: 13",
    `Sec-WebSocket-Protocol: ${protocol}`,
    "",
    "",
  ].join("\r\n"));

  const handshake = await readUntil(socket, (buffer) => {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      return null;
    }
    return {
      headers: buffer.subarray(0, headerEnd).toString("utf8"),
      rest: buffer.subarray(headerEnd + 4),
    };
  }, 10000, "WebSocket handshake");
  const statusLine = handshake.headers.split("\r\n")[0] || "";
  const status = Number(statusLine.match(/^HTTP\/\d(?:\.\d)?\s+(\d+)/)?.[1] || 0);
  if (status !== 101) {
    socket.end();
    const responseBody = handshake.rest.toString("utf8").trim();
    throw new Error(`MQTT WebSocket handshake failed with HTTP ${status || "unknown"}: ${responseBody || statusLine}`);
  }
  return { socket, buffer: handshake.rest };
}

async function readRawWebSocketMessage(socket, initialBuffer, timeoutMs) {
  let buffered = initialBuffer || Buffer.alloc(0);
  const parsed = parseWebSocketFrame(buffered);
  if (parsed) {
    return parsed;
  }
  return readUntil(socket, (buffer) => {
    return parseWebSocketFrame(Buffer.concat([buffered, buffer]));
  }, timeoutMs, "WebSocket message");
}

async function rawMqttWebSocketPublish({ url, clientId, topic, payload }) {
  const { socket, buffer } = await openRawWebSocket(url, "mqtt");
  try {
    socket.write(webSocketFrame(mqttConnectPacket(clientId)));
    const connackFrame = await readRawWebSocketMessage(socket, buffer, 10000);
    if (connackFrame.opcode === 8) {
      throw new Error(`MQTT WebSocket closed during CONNACK: ${connackFrame.payload.toString("hex")}`);
    }
    const bytes = connackFrame.payload;
    if (bytes[0] !== 0x20 || bytes[3] !== 0) {
      throw new Error(`MQTT connection refused with packet ${bytes.toString("hex")}.`);
    }
    socket.write(webSocketFrame(mqttPublishPacket(topic, payload)));
    socket.write(webSocketFrame(mqttDisconnectPacket()));
    socket.end();
    return { mqtt: true, client: "raw-tls-websocket" };
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

function parseMqttPublish(packet) {
  if ((packet[0] & 0xf0) !== 0x30) {
    return null;
  }
  let multiplier = 1;
  let length = 0;
  let offset = 1;
  let encoded;
  do {
    encoded = packet[offset];
    length += (encoded & 127) * multiplier;
    multiplier *= 128;
    offset += 1;
  } while ((encoded & 128) !== 0);
  const payloadEnd = offset + length;
  const topicLength = packet.readUInt16BE(offset);
  offset += 2;
  const topic = packet.subarray(offset, offset + topicLength).toString("utf8");
  offset += topicLength;
  const qos = (packet[0] & 0x06) >> 1;
  if (qos > 0) {
    offset += 2;
  }
  const message = packet.subarray(offset, payloadEnd).toString("utf8");
  return { topic, message };
}

async function rawMqttWebSocketStatus({ url, clientId, stateTopic, controlTopic, timeoutMs = 10000 }) {
  const { socket, buffer } = await openRawWebSocket(url, "mqtt");
  let readBuffer = buffer;
  try {
    socket.write(webSocketFrame(mqttConnectPacket(clientId)));
    const connackFrame = await readRawWebSocketMessage(socket, readBuffer, timeoutMs);
    readBuffer = connackFrame.rest || Buffer.alloc(0);
    if (connackFrame.opcode === 8) {
      throw new Error(`MQTT WebSocket closed during CONNACK: ${connackFrame.payload.toString("hex")}`);
    }
    if (connackFrame.payload[0] !== 0x20 || connackFrame.payload[3] !== 0) {
      throw new Error(`MQTT connection refused with packet ${connackFrame.payload.toString("hex")}.`);
    }

    socket.write(webSocketFrame(mqttSubscribePacket(1, stateTopic, 1)));
    let subscribed = false;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const frame = await readRawWebSocketMessage(socket, readBuffer, Math.max(1000, timeoutMs - (Date.now() - start)));
      readBuffer = frame.rest || Buffer.alloc(0);
      const packet = frame.payload;
      if ((packet[0] & 0xf0) === 0x90) {
        subscribed = true;
        socket.write(webSocketFrame(mqttPublishPacket(controlTopic, JSON.stringify({ fpsh: 1 }))));
        continue;
      }
      const publish = parseMqttPublish(packet);
      if (publish && publish.topic === stateTopic) {
        socket.write(webSocketFrame(mqttDisconnectPacket()));
        socket.end();
        return JSON.parse(publish.message);
      }
    }
    throw new Error(subscribed ? "Timed out waiting for AC state report." : "Timed out subscribing to AC state report.");
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

function waitForWebSocketOpen(socket, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeout;
    const finish = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (error) {
        reject(error);
        return;
      }
      resolve();
    };
    timeout = setTimeout(() => finish(new Error("MQTT WebSocket connection timed out.")), timeoutMs);
    socket.addEventListener("open", () => {
      finish();
    }, { once: true });
    socket.addEventListener("error", (event) => {
      const detail = event?.message || event?.error?.message || event?.type || "no details";
      finish(new Error(`MQTT WebSocket connection failed (${detail}).`));
    }, { once: true });
    socket.addEventListener("close", (event) => {
      const code = event?.code ? ` code=${event.code}` : "";
      const reason = event?.reason ? ` reason=${event.reason}` : "";
      finish(new Error(`MQTT WebSocket closed before open.${code}${reason}`));
    }, { once: true });
  });
}

function waitForConnack(socket, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("MQTT CONNACK timed out.")), timeoutMs);
    socket.addEventListener("message", async (event) => {
      clearTimeout(timeout);
      const bytes = Buffer.isBuffer(event.data)
        ? event.data
        : event.data instanceof ArrayBuffer
          ? Buffer.from(event.data)
          : typeof event.data === "string"
            ? Buffer.from(event.data, "binary")
            : Buffer.from(await event.data.arrayBuffer());
      if (bytes[0] !== 0x20 || bytes[3] !== 0) {
        reject(new Error(`MQTT connection refused with packet ${bytes.toString("hex")}.`));
        return;
      }
      resolve();
    }, { once: true });
  });
}

async function mqttWebSocketPublish({ endpoint, region, service, credentials, clientId, topic, payload, includeExpires, port, signHostWithPort }) {
  if (typeof WebSocket !== "function") {
    throw new Error("This Node runtime does not provide WebSocket. Use Node 22+ or install a WebSocket client.");
  }
  const url = awsPresignedUrl({
    endpoint,
    region,
    service,
    pathName: "/mqtt",
    credentials,
    expires: includeExpires,
    port,
    signHostWithPort,
  });
  if (process.env.BLUESTAR_WS_CLIENT !== "builtin") {
    return rawMqttWebSocketPublish({
      url,
      clientId,
      topic,
      payload,
    });
  }
  const socket = new WebSocket(url, "mqtt");
  await waitForWebSocketOpen(socket, 10000);
  socket.send(mqttConnectPacket(clientId));
  await waitForConnack(socket, 10000);
  socket.send(mqttPublishPacket(topic, payload));
  await new Promise((resolve) => setTimeout(resolve, 250));
  socket.send(mqttDisconnectPacket());
  socket.close();
  return { mqtt: true };
}

function encodeTopicPath(topic) {
  return topic.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

function blueStarHeaders(sessionId) {
  return {
    "Content-Type": "application/json",
    "User-Agent": "com.bluestarindia.bluesmart",
    "X-APP-VER": "v4.13.12-148",
    "X-OS-NAME": "Android",
    "X-OS-VER": "v15-35",
    ...(sessionId ? { "X-APP-SESSION": sessionId } : {}),
  };
}

function inferBlueStarAuthType(authId) {
  return authId.length === 10 && /^[0-9]+$/.test(authId) ? 1 : 0;
}

async function loginBlueStar(provider) {
  const authId = process.env[provider.authIdEnv || "BLUESTAR_AUTH_ID"];
  const password = process.env[provider.passwordEnv || "BLUESTAR_PASSWORD"];
  if (!authId || !password) {
    throw new Error("Blue Star login is missing. Set BLUESTAR_AUTH_ID and BLUESTAR_PASSWORD, or set BLUESTAR_AWS_ACCESS_KEY_ID and BLUESTAR_AWS_SECRET_ACCESS_KEY.");
  }
  const authTypeFromEnv = process.env[provider.authTypeEnv || "BLUESTAR_AUTH_TYPE"];
  const payload = {
    auth_id: authId,
    auth_type: authTypeFromEnv === undefined ? inferBlueStarAuthType(authId) : Number(authTypeFromEnv),
    password,
  };
  const response = await fetch(provider.loginUrl || "https://n3on22cp53.execute-api.ap-south-1.amazonaws.com/prod/auth/login", {
    method: "POST",
    headers: blueStarHeaders(),
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Blue Star login failed with HTTP ${response.status}: ${JSON.stringify(body)}`);
  }
  if (!body.mi) {
    throw new Error("Blue Star login response did not include MQTT broker credentials.");
  }
  const brokerInfo = Buffer.from(body.mi, "base64").toString("utf8").split("::");
  if (brokerInfo.length < 3) {
    throw new Error("Blue Star login returned broker info in an unexpected format.");
  }
  return {
    endpoint: brokerInfo[0],
    accessKeyId: brokerInfo[1],
    secretAccessKey: brokerInfo[2],
    sessionId: body.session || "",
  };
}

async function getBlueStarCredentials(provider) {
  if (process.env.BLUESTAR_AWS_ACCESS_KEY_ID && process.env.BLUESTAR_AWS_SECRET_ACCESS_KEY) {
    return {
      endpoint: provider.endpoint,
      accessKeyId: process.env.BLUESTAR_AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.BLUESTAR_AWS_SECRET_ACCESS_KEY,
      sessionToken: process.env.BLUESTAR_AWS_SESSION_TOKEN,
      sessionId: "",
    };
  }
  return loginBlueStar(provider);
}

async function getGoogleAccessToken(provider) {
  const directToken = process.env[provider.accessTokenEnv || "GOOGLE_SDM_ACCESS_TOKEN"];
  if (directToken) {
    return directToken;
  }

  const refreshToken = process.env[provider.refreshTokenEnv || "GOOGLE_SDM_REFRESH_TOKEN"];
  const clientId = process.env[provider.clientIdEnv || "GOOGLE_SDM_CLIENT_ID"];
  const clientSecret = process.env[provider.clientSecretEnv || "GOOGLE_SDM_CLIENT_SECRET"];
  if (!refreshToken || !clientId || !clientSecret) {
    throw new Error("Google SDM credentials are missing. Set access token or refresh-token environment variables.");
  }

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const body = await response.json();
  if (!response.ok || !body.access_token) {
    throw new Error(`Google token refresh failed: ${JSON.stringify(body)}`);
  }
  return body.access_token;
}

function googleCommandFor(device, command, value) {
  if (command === "turnOff") {
    return {
      command: "sdm.devices.commands.ThermostatMode.SetMode",
      params: { mode: "OFF" },
    };
  }
  if (command === "turnOn") {
    return {
      command: "sdm.devices.commands.ThermostatMode.SetMode",
      params: { mode: device.defaultMode || "COOL" },
    };
  }
  if (command === "setTemperature") {
    const temp = Number(value || device.defaultTemperatureCelsius || 24);
    if (!Number.isFinite(temp)) {
      throw new Error("Temperature must be a number.");
    }
    return {
      command: "sdm.devices.commands.ThermostatTemperatureSetpoint.SetCool",
      params: { coolCelsius: temp },
    };
  }
  throw new Error(`Google SDM thermostat command is not supported: ${command}`);
}

async function executeGoogleSdm(device, command, value) {
  const provider = config.providers?.[device.provider] || config.providers?.["google-sdm"];
  if (!provider?.projectId || !provider?.deviceId) {
    throw new Error("Google SDM provider needs projectId and deviceId in config.json.");
  }
  const accessToken = await getGoogleAccessToken(provider);
  const payload = googleCommandFor(device, command, value);
  const url = `https://smartdevicemanagement.googleapis.com/v1/enterprises/${encodeURIComponent(provider.projectId)}/devices/${encodeURIComponent(provider.deviceId)}:executeCommand`;
  return postJson(url, payload, { Authorization: `Bearer ${accessToken}` });
}

async function executeWebhook(device, command, value) {
  const provider = config.providers?.[device.provider];
  const commandConfig = provider?.commandUrls?.[command];
  if (!commandConfig?.url) {
    throw new Error(`Webhook provider has no URL for command ${command}.`);
  }

  const context = { device, command, value };
  const headers = interpolateObject(commandConfig.headers || {}, context);
  const body = interpolateObject(commandConfig.body || { command, value, deviceId: device.id }, context);
  const response = await fetch(interpolate(commandConfig.url, context), {
    method: commandConfig.method || "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Webhook failed with HTTP ${response.status}: ${text}`);
  }
  return text ? { response: text } : {};
}

async function executeBlueStarLocal(device, command, value) {
  const provider = config.providers?.[device.provider];
  if (!provider) {
    throw new Error("Blue Star local provider is missing from config.json.");
  }
  if (!provider.commandUrls) {
    throw new Error("Blue Star local Wi-Fi API is not documented yet. Run discovery, then add commandUrls for the discovered endpoint.");
  }
  return executeWebhook(device, command, value);
}

function blueStarCloudPayload(provider, device, command, value) {
  const template = provider.commandPayloads?.[command];
  if (!template) {
    throw new Error(`Blue Star cloud provider has no payload template for command ${command}. Capture the app payload, then add providers.bluestar-cloud.commandPayloads.${command}.`);
  }
  const desired = interpolateObject(template, { device, command, provider, value });
  if (provider.wrapShadow === false) {
    return desired;
  }
  if (provider.addTimestamp !== false && desired.ts === undefined) {
    desired.ts = Date.now();
  }
  return {
    state: {
      desired: {
        ...desired,
        src: provider.source || "anmq",
      },
    },
  };
}

function blueStarClientId(provider, credentials) {
  return provider.clientId || (credentials.sessionId ? `u-${credentials.sessionId}` : "ac-control");
}

function blueStarMqttAttemptOptions(provider) {
  const services = [
    provider.signingService || "iotdata",
    provider.fallbackSigningService || "iotdevicegateway",
  ].filter((item, index, list) => item && list.indexOf(item) === index);
  const includeExpiresOptions = provider.includeWebSocketExpires === true ? [true, false] : [false, true];
  const hostOptions = provider.includeWebSocketPort === false
    ? [{ port: undefined, signHostWithPort: false, label: "" }]
    : [
        { port: Number(provider.webSocketPort || 443), signHostWithPort: true, label: " host:port" },
        { port: Number(provider.webSocketPort || 443), signHostWithPort: false, label: " url-port" },
        { port: undefined, signHostWithPort: false, label: "" },
      ];
  const attempts = [];
  for (const service of services) {
    for (const includeExpires of includeExpiresOptions) {
      for (const hostOption of hostOptions) {
        attempts.push({
          service,
          includeExpires,
          ...hostOption,
          label: `${service}${includeExpires === false ? " without expires" : ""}${hostOption.label}`,
        });
      }
    }
  }
  return attempts;
}

async function executeBlueStarCloud(device, command, value) {
  const provider = config.providers?.[device.provider] || config.providers?.["bluestar-cloud"];
  if (!provider?.thingId) {
    throw new Error("Blue Star cloud provider needs thingId in config.json.");
  }
  const credentials = await getBlueStarCredentials(provider);
  const endpoint = provider.endpoint || credentials.endpoint;
  if (!endpoint) {
    throw new Error("Blue Star cloud provider needs an endpoint from config.json or login response.");
  }
  const region = provider.region || "ap-south-1";
  const topic = interpolate(provider.controlTopic || "$aws/things/${THING_ID}/shadow/update", {
    device,
    command,
    provider,
    value,
  });
  const payload = JSON.stringify(blueStarCloudPayload(provider, device, command, value));
  if ((provider.transport || "mqtt-websocket") !== "https") {
    const errors = [];
    for (const attempt of blueStarMqttAttemptOptions(provider)) {
      try {
        return await mqttWebSocketPublish({
          endpoint,
          region,
          service: attempt.service,
          credentials,
          clientId: blueStarClientId(provider, credentials),
          topic,
          payload,
          includeExpires: attempt.includeExpires,
          port: attempt.port,
          signHostWithPort: attempt.signHostWithPort,
        });
      } catch (error) {
        errors.push(`${attempt.label}: ${error.message}`);
      }
    }
    throw new Error(`MQTT WebSocket publish failed after ${errors.length} attempt(s): ${errors.join(" | ")}`);
  }
  return awsSignedFetch({
    method: "POST",
    endpoint,
    region,
    service: provider.signingService || "iotdata",
    pathName: `/topics/${encodeTopicPath(topic)}`,
    query: `qos=${Number(provider.qos || 0)}`,
    payload,
    headers: { "content-type": "application/json" },
    credentials,
  });
}

async function getBlueStarCloudStatus(device) {
  const provider = config.providers?.[device.provider] || config.providers?.["bluestar-cloud"];
  if (!provider?.thingId) {
    throw new Error("Blue Star cloud provider needs thingId in config.json.");
  }
  const credentials = await getBlueStarCredentials(provider);
  const endpoint = provider.endpoint || credentials.endpoint;
  const region = provider.region || "ap-south-1";
  const stateTopic = interpolate(provider.stateTopic || "things/${THING_ID}/state/reported", { device, provider });
  const controlTopic = interpolate(provider.forceSyncTopic || "things/${THING_ID}/control", { device, provider });
  const errors = [];
  for (const attempt of blueStarMqttAttemptOptions(provider)) {
    try {
      const url = awsPresignedUrl({
        endpoint,
        region,
        service: attempt.service,
        pathName: "/mqtt",
        credentials,
        expires: attempt.includeExpires,
        port: attempt.port,
        signHostWithPort: attempt.signHostWithPort,
      });
      const raw = await rawMqttWebSocketStatus({
        url,
        clientId: blueStarClientId(provider, credentials),
        stateTopic,
        controlTopic,
        timeoutMs: Number(provider.statusTimeoutMs || 12000),
      });
      return normalizeBlueStarStatus(raw);
    } catch (error) {
      errors.push(`${attempt.label}: ${error.message}`);
    }
  }
  throw new Error(`MQTT WebSocket status failed after ${errors.length} attempt(s): ${errors.join(" | ")}`);
}

function normalizeBlueStarStatus(raw) {
  const state = raw?.state?.reported || raw?.state || raw;
  const labels = {
    fanSpeed: { 2: "Low", 3: "Medium", 4: "High", 6: "Turbo", 7: "Auto" },
    mode: { 0: "Fan", 1: "Heat", 2: "Cool", 3: "Dry", 4: "Auto" },
    swing: { 0: "Off", 1: "On", 2: "Level 1", 3: "Level 2", 4: "Level 3", 5: "Level 4", 6: "Auto" },
  };
  return {
    raw,
    state,
    summary: {
      power: state.pow === 1 ? "On" : state.pow === 0 ? "Off" : "Unknown",
      display: state.display === 1 ? "On" : state.display === 0 ? "Off" : "Unknown",
      temperatureCelsius: state.stemp ?? null,
      ambientTemperatureCelsius: state.ctemp ?? null,
      fanSpeed: labels.fanSpeed[state.fspd] || (state.fspd ?? "Unknown"),
      mode: labels.mode[state.mode] || (state.mode ?? "Unknown"),
      horizontalSwing: labels.swing[state.hswing] || (state.hswing ?? "Unknown"),
      verticalSwing: labels.swing[state.vswing] || (state.vswing ?? "Unknown"),
    },
  };
}

async function getDeviceStatus(device) {
  if (device.provider === "bluestar-cloud") {
    return getBlueStarCloudStatus(device);
  }
  if (device.provider === "mock") {
    return { raw: {}, state: {}, summary: { provider: "mock" } };
  }
  throw new Error(`Status is not implemented for provider ${device.provider}.`);
}

async function executeCommand(device, command, value) {
  if (device.provider === "mock") {
    log(`mock device=${device.id} command=${command} value=${value ?? ""}`);
    return { simulated: true };
  }
  if (device.provider === "google-sdm") {
    return executeGoogleSdm(device, command, value);
  }
  if (device.provider === "bluestar-local") {
    return executeBlueStarLocal(device, command, value);
  }
  if (device.provider === "bluestar-cloud") {
    return executeBlueStarCloud(device, command, value);
  }
  return executeWebhook(device, command, value);
}

function serveStatic(req, res, pathname) {
  const filePath = pathname === "/" ? path.join(root, "index.html") : path.join(root, pathname.slice(1));
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(root)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }
  fs.readFile(resolved, (error, content) => {
    if (error) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }
    const contentType = mimeTypes[path.extname(resolved).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${host}:${port}`);

  try {
    if (req.method === "GET" && requestUrl.pathname === "/api/health") {
      sendJson(res, 200, { ok: true, devices: (config.devices || []).length });
      return;
    }
    if (req.method === "GET" && requestUrl.pathname === "/api/devices") {
      sendJson(res, 200, { devices: (config.devices || []).map(publicDevice) });
      return;
    }
    if (req.method === "POST" && requestUrl.pathname === "/api/reload") {
      config = loadConfig();
      sendJson(res, 200, { ok: true, devices: (config.devices || []).map(publicDevice) });
      return;
    }
    if (req.method === "GET" && requestUrl.pathname === "/api/network/interfaces") {
      sendJson(res, 200, { networks: localNetworkDefaults() });
      return;
    }
    if (req.method === "POST" && requestUrl.pathname === "/api/discovery/scan") {
      const body = await readBody(req);
      sendJson(res, 200, await scanLan(body));
      return;
    }

    const statusMatch = requestUrl.pathname.match(/^\/api\/devices\/([^/]+)\/status$/);
    if (req.method === "GET" && statusMatch) {
      const device = findDevice(decodeURIComponent(statusMatch[1]));
      if (!device) {
        sendJson(res, 404, { error: "Device not configured." });
        return;
      }
      sendJson(res, 200, { ok: true, device: publicDevice(device), status: await getDeviceStatus(device) });
      return;
    }

    const commandMatch = requestUrl.pathname.match(/^\/api\/devices\/([^/]+)\/commands$/);
    if (req.method === "POST" && commandMatch) {
      const device = findDevice(decodeURIComponent(commandMatch[1]));
      if (!device) {
        sendJson(res, 404, { error: "Device not configured." });
        return;
      }
      const body = await readBody(req);
      if (!body.command) {
        sendJson(res, 400, { error: "Missing command." });
        return;
      }
      const result = await executeCommand(device, body.command, body.value);
      log(`ok device=${device.id} command=${body.command}`);
      sendJson(res, 200, { ok: true, device: publicDevice(device), result });
      return;
    }

    if (req.method === "GET") {
      serveStatic(req, res, requestUrl.pathname);
      return;
    }

    sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    log(`error ${error.message}`);
    sendJson(res, 500, { error: error.message });
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    const message = `AC Control service is already running at http://${host}:${port}`;
    log(message);
    console.log(message);
    console.log("Use the existing tray/control panel, or stop the existing node process before starting another one.");
    process.exit(0);
  }
  throw error;
});

server.listen(port, host, () => {
  log(`service listening at http://${host}:${port}`);
  console.log(`AC Control service listening at http://${host}:${port}`);
});
