import Foundation
import Capacitor
import WidgetKit

// The native queue handles a widget tap before the WebView or its listener exists.
enum WidgetRoute {
    static let available = Notification.Name("dailyspace.widget.route")
    private static var pending = false

    static func receive(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == "dailyspace", url.host?.lowercased() == "today",
              url.path.isEmpty || url.path == "/" else { return false }
        pending = true
        NotificationCenter.default.post(name: available, object: nil)
        return true
    }

    static func consume() -> Bool {
        let value = pending
        pending = false
        return value
    }
}

@objc(DailySpaceWidgetPlugin)
public class DailySpaceWidgetPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "DailySpaceWidgetPlugin"
    public let jsName = "DailySpaceWidget"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "updateSnapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "consumeRoute", returnType: CAPPluginReturnPromise)
    ]
    private var routeObserver: NSObjectProtocol?

    override public func load() {
        routeObserver = NotificationCenter.default.addObserver(forName: WidgetRoute.available, object: nil, queue: .main) { [weak self] _ in
            self?.notifyListeners("routeAvailable", data: [:], retainUntilConsumed: true)
        }
    }

    deinit {
        if let observer = routeObserver { NotificationCenter.default.removeObserver(observer) }
    }

    @objc func updateSnapshot(_ call: CAPPluginCall) {
        guard let object = call.getObject("snapshot"), let data = try? JSONSerialization.data(withJSONObject: object) else {
            call.reject("A widget snapshot is required.")
            return
        }
        DispatchQueue.main.async {
            do {
                try WidgetStore.write(data)
                WidgetCenter.shared.reloadTimelines(ofKind: WidgetStore.kind)
                call.resolve()
            } catch { call.reject(error.localizedDescription) }
        }
    }

    @objc func consumeRoute(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            call.resolve(["route": WidgetRoute.consume() ? "today" : ""])
        }
    }
}
