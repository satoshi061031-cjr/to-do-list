import Foundation
import WidgetKit

struct SpendEntry: TimelineEntry {
    let date: Date
    let state: SpendState

    static func timeline(for state: SpendState, now: Date = .now, timeZone: TimeZone = .current) -> Timeline<SpendEntry> {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let midnight = calendar.dateInterval(of: .day, for: now)!.end
        let refreshInterval: TimeInterval = 15 * 60
        let reload = min(midnight, now.addingTimeInterval(refreshInterval))
        var entries: [SpendEntry]
        switch state {
        case .value(let spending, let offline) where spending.matches(now, in: timeZone):
            let staleAt = min(reload, spending.updated.addingTimeInterval(refreshInterval))
            let cached = SpendState.value(spending, offline: true)
            let startsCached = offline || staleAt.timeIntervalSince(now) <= 0
            entries = [SpendEntry(date: now, state: startsCached ? cached : state)]
            if !startsCached && staleAt < midnight {
                entries.append(SpendEntry(date: staleAt, state: cached))
            }
            // A scheduled entry hides the previous day's total even without a network reload.
            entries.append(SpendEntry(date: midnight, state: .unavailable))
        case .value:
            entries = [SpendEntry(date: now, state: .unavailable)]
        default:
            entries = [SpendEntry(date: now, state: state)]
        }
        return Timeline(entries: entries, policy: .after(reload))
    }
}
