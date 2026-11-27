import SwiftUI
import WidgetKit

struct SpendingProvider: TimelineProvider {
    func placeholder(in context: Context) -> SpendEntry {
        SpendEntry(date: .now, state: .unavailable)
    }

    func getSnapshot(in context: Context, completion: @escaping (SpendEntry) -> Void) {
        completion(SpendEntry(date: .now, state: WatchAPI.cachedState()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<SpendEntry>) -> Void) {
        Task {
            #if DAYFLY_WIDGET_PUSH
            if #available(watchOS 26, *), let info = await WidgetCenter.shared.currentPushInfo {
                await WatchStore.syncWidgetPush(info.token)
            }
            #endif
            let state = await WatchAPI.refresh()
            completion(SpendEntry.timeline(for: state))
        }
    }
}

#if DAYFLY_WIDGET_PUSH
@available(watchOS 26, *)
private struct SpendingPushHandler: WidgetPushHandler {
    func pushTokenDidChange(_ pushInfo: WidgetPushInfo, widgets: [WidgetInfo]) {
        let hasSpending = widgets.contains { $0.kind == "DayflySpending" }
        Task { await WatchStore.syncWidgetPush(hasSpending ? pushInfo.token : nil) }
    }
}
#endif

private extension SpendEntry {
    static func sample(amount: String = "75.30", cached: Bool = false) -> Self {
        let date = Date.now
        let checked = cached ? date.addingTimeInterval(-20 * 60) : date
        let spending = Spending(date: Spending.day(date), currency: "CNY", amount: amount,
                                checkedAt: checked.timeIntervalSince1970 * 1000, timeZoneIdentifier: TimeZone.current.identifier)
        return SpendEntry(date: date, state: .value(spending, offline: cached))
    }
}

struct SpendingFace: View {
    @Environment(\.widgetFamily) private var family
    @Environment(\.showsWidgetLabel) private var showsWidgetLabel
    let entry: SpendEntry

    private var state: SpendState {
        if case .value(let value, _) = entry.state, !value.matches(entry.date) { return .unavailable }
        return entry.state
    }

    private var spending: Spending? {
        if case .value(let value, _) = state { return value }
        return nil
    }

    private var isCached: Bool {
        if case .value(_, let offline) = state { return offline }
        return false
    }

    private var symbol: String {
        switch state {
        case .unpaired: return "link"
        case .unsynced: return "arrow.triangle.2.circlepath"
        case .unavailable: return "clock"
        case .value: return isCached ? "clock" : "wallet.pass"
        }
    }

    private var shortHint: String {
        switch state {
        case .unpaired: return WatchCopy.text("Pair", "配对")
        case .unsynced: return WatchCopy.text("Sync", "同步")
        case .unavailable: return WatchCopy.text("Pending", "待更新")
        case .value: return isCached ? WatchCopy.text("Cached", "上次") : WatchCopy.text("Today", "今日")
        }
    }

    private var timestamp: String {
        guard let spending else { return state.hint }
        return state.hint + " " + spending.updated.formatted(date: .omitted, time: .shortened)
    }

    private var accessibilityText: String {
        guard let spending else { return WatchCopy.title + ", " + state.hint }
        return [WatchCopy.title, spending.currency + " " + spending.displayAmount(), timestamp].joined(separator: ", ")
    }

    var body: some View {
        Group {
            switch family {
            case .accessoryInline:
                if let spending {
                    Label {
                        Text(verbatim: "\(spending.currency) \(spending.displayAmount(compact: true)) · \(shortHint)")
                    } icon: { Image(systemName: symbol) }
                } else {
                    Text(verbatim: WatchCopy.title + " · " + state.hint)
                }
            case .accessoryCircular:
                ZStack {
                    AccessoryWidgetBackground()
                    VStack(spacing: 0) {
                        if let spending {
                            HStack(spacing: 0) {
                                if isCached { Image(systemName: symbol) }
                                Text(verbatim: spending.currency)
                            }.font(.caption2)
                            Text(verbatim: spending.displayAmount(compact: true))
                                .font(.headline).monospacedDigit()
                        } else {
                            Image(systemName: symbol)
                            Text(verbatim: shortHint).font(.caption2)
                        }
                    }
                    .lineLimit(1).minimumScaleFactor(0.6).padding(.horizontal, 4)
                }
                .widgetLabel(WatchCopy.title)
            case .accessoryCorner:
                if let spending {
                    let amount = spending.displayAmount(compact: true)
                    let label = showsWidgetLabel ? amount : (isCached ? "↺ " : "") + spending.currency + " " + amount
                    Text(verbatim: label)
                        .font(.headline).monospacedDigit().lineLimit(1).minimumScaleFactor(0.6)
                        .widgetCurvesContent()
                        .widgetLabel(shortHint + " · " + spending.currency)
                } else {
                    Text(verbatim: shortHint).widgetCurvesContent().widgetLabel(state.hint)
                }
            default:
                VStack(alignment: .leading, spacing: 0) {
                    Label { Text(verbatim: WatchCopy.title) } icon: { Image(systemName: "wallet.pass").widgetAccentable() }
                        .font(.caption)
                    if let spending {
                        ViewThatFits(in: .horizontal) {
                            Text(verbatim: spending.currency + " " + spending.displayAmount()).fixedSize()
                            Text(verbatim: spending.currency + " " + spending.displayAmount(compact: true))
                                .minimumScaleFactor(0.6)
                        }
                        .font(.headline).monospacedDigit().lineLimit(1)
                        Text(verbatim: timestamp).font(.caption2).foregroundStyle(.secondary)
                    } else { Text(verbatim: state.hint).font(.headline) }
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityText))
        .privacySensitive()
        .containerBackground(for: .widget) { Color.clear }
    }
}

@main
struct DayflySpendingWidget: Widget {
    private var spendingConfiguration: some WidgetConfiguration {
        StaticConfiguration(kind: "DayflySpending", provider: SpendingProvider()) { SpendingFace(entry: $0) }
            .configurationDisplayName(WatchCopy.title)
            .description(WatchCopy.text("Your personal spending in your ledger’s base currency.", "以账本本位币显示今天的个人支出。"))
            .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline, .accessoryCorner])
    }
    var body: some WidgetConfiguration {
        #if DAYFLY_WIDGET_PUSH
        spendingConfiguration.pushHandler(SpendingPushHandler.self)
        #else
        spendingConfiguration
        #endif
    }
}

#if DEBUG
#Preview("矩形", as: .accessoryRectangular) { DayflySpendingWidget() } timeline: {
    SpendEntry.sample()
    SpendEntry(date: .now, state: .unsynced)
}
#Preview("圆形", as: .accessoryCircular) { DayflySpendingWidget() } timeline: {
    SpendEntry.sample(amount: "0.00")
    SpendEntry.sample(amount: "123456.78", cached: true)
}
#Preview("角落", as: .accessoryCorner) { DayflySpendingWidget() } timeline: {
    SpendEntry.sample()
    SpendEntry(date: .now, state: .unpaired)
}
#Preview("行内", as: .accessoryInline) { DayflySpendingWidget() } timeline: {
    SpendEntry.sample(cached: true)
    SpendEntry(date: .now, state: .unavailable)
}
#endif
