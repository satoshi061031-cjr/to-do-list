import Capacitor

class DailySpaceViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(DailySpaceWidgetPlugin())
    }
}
