import QtQuick
import qs.Ui

BarWidget {
  id: root
  moduleName: "djsmanchanda.blue-star-ac"

  readonly property bool opened: panelLoader.item ? panelLoader.item.opened : false

  function injectPanel() {
    var panel = panelLoader.item
    if (!panel) return
    if ("bar" in panel) panel.bar = root.bar
    if ("settings" in panel) panel.settings = root.settings
  }

  function open() { if (panelLoader.item) panelLoader.item.open() }
  function close() { if (panelLoader.item) panelLoader.item.close() }
  function toggle() { if (panelLoader.item) panelLoader.item.toggle() }

  implicitWidth: panelLoader.item ? panelLoader.item.implicitWidth : 0
  implicitHeight: panelLoader.item ? panelLoader.item.implicitHeight : 0

  Loader {
    id: panelLoader
    active: true
    source: Qt.resolvedUrl("Panel.qml")
    onLoaded: {
      root.injectPanel()
      Qt.callLater(root.injectPanel)
    }
  }

  onBarChanged: root.injectPanel()
  onSettingsChanged: root.injectPanel()
}
