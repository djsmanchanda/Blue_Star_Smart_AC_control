import QtQuick
import QtQuick.Controls
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui

Panel {
  id: root
  moduleName: "blue-star-ac"
  ipcTarget: "blue-star-ac"
  manageIpc: false
  property var ac: ({})
  property string message: ""
  readonly property bool acIsOn: ac.status && ac.status.summary && ac.status.summary.power === "On"
  readonly property color acColor: acIsOn
    ? "#ffffff"
    : "#6b7280"
  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  function refresh() { if (!statusProc.running) statusProc.running = true }
  function run(args) { actionProc.command = ["ac"].concat(args); actionProc.running = true; refresh() }
  function statusText() {
    var s = ac.status || {}
    var summary = s.summary || {}
    return (summary.power || "Unknown") + " · " + (summary.temperatureCelsius || "—") + "°C"
  }

  IpcHandler {
    target: "blue-star-ac"
    function refresh(): void { root.refresh() }
    function on(): void { root.run(["on"]) }
    function off(): void { root.run(["off"]) }
    function toggle(): void { root.run(["status"]) }
    function open(): void { root.open() }
    function close(): void { root.close() }
    function show(): void { root.open() }
    function hide(): void { root.close() }
  }

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: "❄"
    slotSize: Style.bar.iconSlot
    foreground: root.acColor
    useActiveColor: false
    tooltipText: root.statusText()
    onPressed: function(b) { root.toggle() }
  }

  KeyboardPanel {
    id: panel
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.opened
    contentWidth: panel.fittedContentWidth(Style.space(360))
    contentHeight: panel.fittedContentHeight(column.implicitHeight)

    Column {
      id: column
      anchors.fill: parent
      spacing: Style.space(10)

      Text {
        text: "Blue Star AC"
        color: root.bar.foreground
        font.family: root.bar.fontFamily
        font.pixelSize: Style.font.title
        font.bold: true
      }

      Text {
        text: root.statusText()
        color: root.bar.foreground
        font.family: root.bar.fontFamily
        font.pixelSize: Style.font.body
      }

      Row {
        spacing: Style.space(6)
        Button { text: "On"; onClicked: root.run(["on"]) }
        Button { text: "Off"; onClicked: root.run(["off"]) }
        Button { text: "Display"; onClicked: root.run(["display", "off"]) }
      }

      Row {
        spacing: Style.space(6)
        Button { text: "−1°"; onClicked: root.run(["1-"]) }
        Button { text: "Set temp"; onClicked: root.run(["set", "24"]) }
        Button { text: "+1°"; onClicked: root.run(["1+"]) }
      }

      Text {
        text: root.message
        color: Qt.darker(root.bar.foreground, 1.4)
        font.family: root.bar.fontFamily
        font.pixelSize: Style.font.caption
      }
    }
  }

  Process {
    id: statusProc
    command: ["ac", "status", "--json"]
    stdout: StdioCollector { waitForEnd: true; onStreamFinished: {
      try { root.ac = JSON.parse(text); root.message = "" }
      catch (error) { root.message = "Run: ac status" }
    } }
  }

  Process { id: actionProc; onExited: refreshAfterAction.restart() }
  Timer { id: refreshAfterAction; interval: 750; repeat: false; onTriggered: root.refresh() }
  Timer { interval: 600000; running: true; repeat: true; onTriggered: root.refresh() }
  Component.onCompleted: root.refresh()
}
