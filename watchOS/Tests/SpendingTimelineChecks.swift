import Foundation
import WidgetKit

@main
struct SpendingTimelineChecks {
    static func main() throws {
        let zone = TimeZone(identifier: "Asia/Kuala_Lumpur")!
        let instant = ISO8601DateFormatter()
        let now = instant.date(from: "2026-11-27T15:40:00Z")!
        let midnight = instant.date(from: "2026-11-27T16:00:00Z")!
        func reading(_ amount: String = "75.30", checked: Date = now) -> Spending {
            Spending(date: Spending.day(checked, in: zone), currency: "CNY", amount: amount,
                     checkedAt: checked.timeIntervalSince1970 * 1000, timeZoneIdentifier: zone.identifier)
        }
        func states(_ entries: [SpendEntry]) -> [String] {
            entries.map { entry in
                switch entry.state {
                case .unavailable: return "pending"
                case .unpaired: return "pair"
                case .unsynced: return "sync"
                case .value(let value, let offline): return (offline ? "cached:" : "fresh:") + value.amount
                }
            }
        }
        func timeline(_ state: SpendState, at date: Date = now) -> [SpendEntry] {
            SpendEntry.timeline(for: state, now: date, timeZone: zone).entries
        }

        let fresh = timeline(.value(reading(), offline: false))
        precondition(states(fresh) == ["fresh:75.30", "cached:75.30", "pending"])
        precondition(fresh.map(\.date) == [now, now.addingTimeInterval(900), midnight])
        let nearMidnight = midnight.addingTimeInterval(-30)
        let zero = timeline(.value(reading("0.00", checked: nearMidnight), offline: false), at: nearMidnight)
        precondition(states(zero) == ["fresh:0.00", "pending"] && zero.last?.date == midnight)
        precondition(states(timeline(.value(reading(), offline: true))) == ["cached:75.30", "pending"])
        precondition(states(timeline(.value(reading(checked: now.addingTimeInterval(-901)), offline: false))) == ["cached:75.30", "pending"])
        precondition(states(timeline(.value(reading(), offline: true), at: midnight)) == ["pending"])
        precondition(states(timeline(.unpaired) + timeline(.unsynced) + timeline(.unavailable)) == ["pair", "sync", "pending"])

        // Travel between zones on the same calendar date can change which expenses qualify.
        let otherZone = TimeZone(identifier: "Europe/London")!
        precondition(Spending.day(now, in: zone) == Spending.day(now, in: otherZone))
        precondition(!reading().matches(now, in: otherZone))
        let legacy = try JSONDecoder().decode(Spending.self, from: Data(#"{"date":"2026-11-27","currency":"CNY","amount":"54.00","checkedAt":0}"#.utf8))
        precondition(!legacy.matches(now, in: zone))

        let newYork = TimeZone(identifier: "America/New_York")!
        let dstStart = instant.date(from: "2026-03-08T05:00:00Z")!
        let dstReading = Spending(date: "2026-03-08", currency: "USD", amount: "2.00",
                                  checkedAt: dstStart.timeIntervalSince1970 * 1000, timeZoneIdentifier: newYork.identifier)
        let dst = SpendEntry.timeline(for: .value(dstReading, offline: false), now: dstStart, timeZone: newYork)
        precondition(dst.entries.last?.date == dstStart.addingTimeInterval(23 * 3600))
        let en = Locale(identifier: "en_US"), zh = Locale(identifier: "zh_CN")
        precondition(reading("0.00").displayAmount(compact: true, locale: zh) == "0.00")
        precondition(reading().displayAmount(compact: true, locale: en) == "75.30")
        let large = reading("123456.78")
        precondition(large.displayAmount(locale: en) == "123,456.78")
        precondition(large.displayAmount(compact: true, locale: en) == "123K")
        precondition(large.displayAmount(compact: true, locale: zh) == "12.3万")
    }
}
