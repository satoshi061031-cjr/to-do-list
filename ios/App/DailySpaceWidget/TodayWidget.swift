import SwiftUI
import WidgetKit

private struct TodayEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot?
}

private struct TodayProvider: TimelineProvider {
    func placeholder(in context: Context) -> TodayEntry {
        let key = WidgetSnapshot.dateKey(Date())
        return TodayEntry(date: Date(), snapshot: WidgetSnapshot(version: 1, updatedAt: Date().timeIntervalSince1970 * 1000,
            locale: Locale.current.identifier.hasPrefix("zh") ? "zh" : "en", ready: true,
            days: [WidgetDay(date: key, total: 3, completed: 1, items: [
                WidgetTask(title: "Review the day", time: "09:30"), WidgetTask(title: "A little time outside", time: nil)
            ])]))
    }

    func getSnapshot(in context: Context, completion: @escaping (TodayEntry) -> Void) {
        completion(context.isPreview ? placeholder(in: context) : TodayEntry(date: Date(), snapshot: WidgetStore.read()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TodayEntry>) -> Void) {
        let now = Date(), snapshot = WidgetStore.read()
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current
        var entries = [TodayEntry(date: now, snapshot: snapshot)]
        // Roll the cached calendar days at midnight without making network requests.
        for offset in 1...7 {
            if let day = calendar.date(byAdding: .day, value: offset, to: calendar.startOfDay(for: now)) {
                entries.append(TodayEntry(date: day, snapshot: snapshot))
            }
        }
        completion(Timeline(entries: entries, policy: .after(now.addingTimeInterval(6 * 60 * 60))))
    }
}

private struct TodayView: View {
    @Environment(\.widgetFamily) private var family
    let entry: TodayEntry
    private var zh: Bool { entry.snapshot?.locale == "zh" || (entry.snapshot == nil && Locale.current.identifier.hasPrefix("zh")) }
    private var day: WidgetDay? { entry.snapshot?.ready == true ? entry.snapshot?.day(at: entry.date) : nil }
    private func text(_ en: String, _ cn: String) -> String { zh ? cn : en }
    private var stamp: String {
        guard let snapshot = entry.snapshot else { return "" }
        let date = Date(timeIntervalSince1970: snapshot.updatedAt / 1000)
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: zh ? "zh_CN" : "en_US")
        formatter.dateStyle = Calendar.current.isDate(date, inSameDayAs: entry.date) ? .none : .short
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }

    private var header: some View {
        HStack(spacing: 8) {
            Image("Ghost").resizable().scaledToFit().frame(width: 28, height: 28).accessibilityHidden(true)
            Text(text("Today", "今天")).font(.system(size: 16, weight: .medium))
            Spacer(minLength: 4)
            if family == .systemMedium, let day = day {
                Text(text("\(day.remaining) left", "剩余 \(day.remaining) 项"))
                    .font(.system(size: 14)).foregroundStyle(Color("WidgetMuted"))
            }
        }
    }

    @ViewBuilder private func content(rowLimit: Int) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            header
            if let day = day {
                if family == .systemSmall {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text("\(day.remaining)").font(.system(size: 32, weight: .semibold)).monospacedDigit()
                        Text(text("left", "项待办")).font(.system(size: 14)).foregroundStyle(Color("WidgetMuted"))
                    }
                } else if day.items.isEmpty {
                    Spacer(minLength: 0)
                    Text(day.total > 0 ? text("All done for today", "今天的任务已完成") : text("Nothing due today", "今天没有到期任务"))
                        .font(.system(size: 16))
                    Spacer(minLength: 0)
                } else {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(Array(day.items.prefix(rowLimit).enumerated()), id: \.offset) { _, task in
                            HStack(spacing: 8) {
                                Circle().stroke(Color("WidgetMuted"), lineWidth: 1).frame(width: 8, height: 8)
                                Text(task.title).font(.system(size: 16, weight: .medium)).lineLimit(1)
                                Spacer(minLength: 0)
                                if let time = task.time { Text(time).font(.system(size: 14)).monospacedDigit().foregroundStyle(Color("WidgetMuted")) }
                            }
                        }
                    }
                    Spacer(minLength: 0)
                }
                VStack(alignment: .leading, spacing: 4) {
                    ProgressView(value: Double(day.completed), total: Double(max(1, day.total))).tint(Color("WidgetText"))
                    Text("\(day.completed)/\(day.total) · \(stamp)").font(.system(size: 14)).monospacedDigit().foregroundStyle(Color("WidgetMuted"))
                        .lineLimit(1).accessibilityLabel(text("\(day.completed) of \(day.total) completed. Updated \(stamp)", "已完成 \(day.completed)/\(day.total)，更新于 \(stamp)"))
                }
            } else {
                Spacer(minLength: 0)
                Text(text("Open Daily Space", "打开 Daily Space")).font(.system(size: 16, weight: .medium))
                Text(text("Open the app to update Today.", "进入 App，更新今日待办。"))
                    .font(.system(size: 14)).foregroundStyle(Color("WidgetMuted"))
                Spacer(minLength: 0)
            }
        }
        .foregroundStyle(Color("WidgetText"))
        .privacySensitive()
        .widgetURL(URL(string: "dailyspace://today"))
    }

    private var sizedContent: some View {
        GeometryReader { geometry in
            // Preserve the header/progress at smaller widget sizes (including SE).
            let rows = max(1, min(3, Int((geometry.size.height - 76) / 24)))
            content(rowLimit: rows).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }

    var body: some View {
        if #available(iOS 17.0, *) {
            sizedContent.containerBackground(Color("WidgetBackground"), for: .widget)
        } else {
            sizedContent.padding(18).background(Color("WidgetBackground"))
        }
    }
}

@main
struct DailySpaceTodayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: WidgetStore.kind, provider: TodayProvider()) { entry in TodayView(entry: entry) }
            .configurationDisplayName("Daily Space · Today")
            .description("Today's tasks and progress. Open the app to sync changes.")
            .supportedFamilies([.systemSmall, .systemMedium])
    }
}
