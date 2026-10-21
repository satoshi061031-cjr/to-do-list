import Foundation

struct WidgetTask: Codable {
    let title: String
    let time: String?
}

struct WidgetDay: Codable {
    let date: String
    let total: Int
    let completed: Int
    let items: [WidgetTask]
    var remaining: Int { max(0, total - completed) }
}

struct WidgetSnapshot: Codable {
    let version: Int
    let updatedAt: Double
    let locale: String
    let ready: Bool
    let days: [WidgetDay]

    static func dateKey(_ date: Date) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    func day(at date: Date) -> WidgetDay? {
        days.first { $0.date == Self.dateKey(date) }
    }

    var isValid: Bool {
        version == 1 && updatedAt.isFinite && updatedAt > 0 && ["en", "zh"].contains(locale)
        && days.count <= 8 && (ready || days.isEmpty) && Set(days.map(\.date)).count == days.count
        && days.allSatisfy { day in
            day.total >= 0 && day.completed >= 0 && day.completed <= day.total
            && day.items.count <= min(4, day.remaining)
            && day.date.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil
            && day.items.allSatisfy { task in
                !task.title.isEmpty && task.title.count <= 120
                && (task.time == nil || task.time?.range(of: #"^([01]\d|2[0-3]):[0-5]\d$"#, options: .regularExpression) != nil)
            }
        }
    }
}

enum WidgetStore {
    static let kind = "DailySpaceToday"
    private static let key = "daily-space-today-v1"
    static var group: String {
        Bundle.main.object(forInfoDictionaryKey: "DailySpaceAppGroup") as? String ?? "group.app.dailyspace.mobile"
    }

    static func read() -> WidgetSnapshot? {
        guard let data = UserDefaults(suiteName: group)?.data(forKey: key),
              let snapshot = try? JSONDecoder().decode(WidgetSnapshot.self, from: data), snapshot.isValid else { return nil }
        return snapshot
    }

    static func write(_ data: Data) throws {
        guard data.count <= 65_536,
              let snapshot = try? JSONDecoder().decode(WidgetSnapshot.self, from: data), snapshot.isValid else {
            throw NSError(domain: "DailySpaceWidget", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid widget snapshot."])
        }
        guard FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) != nil,
              let defaults = UserDefaults(suiteName: group) else {
            throw NSError(domain: "DailySpaceWidget", code: 2, userInfo: [NSLocalizedDescriptionKey: "Enable the same App Group for App and DailySpaceWidget."])
        }
        defaults.set(try JSONEncoder().encode(snapshot), forKey: key)
    }
}
