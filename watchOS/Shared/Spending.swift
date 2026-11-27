import Foundation
import CryptoKit
import Security

struct Spending: Codable {
    let date: String
    let currency: String
    let amount: String
    let checkedAt: Double
    // Set by the client from the request, never inferred from the server's date.
    // Older cache records have no zone and require one fresh read.
    var timeZoneIdentifier: String? = nil
    var changeTag: String? = nil

    var updated: Date { Date(timeIntervalSince1970: checkedAt / 1000) }
    static func day(_ date: Date, in timeZone: TimeZone = .autoupdatingCurrent) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let p = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", p.year!, p.month!, p.day!)
    }
    func matches(_ now: Date, in timeZone: TimeZone = .autoupdatingCurrent) -> Bool {
        timeZoneIdentifier == timeZone.identifier && date == Self.day(now, in: timeZone)
    }

    func displayAmount(compact: Bool = false, locale: Locale = .autoupdatingCurrent) -> String {
        guard let number = Decimal(string: amount, locale: Locale(identifier: "en_US_POSIX")) else { return amount }
        let style = Decimal.FormatStyle.number.locale(locale)
        if compact && number >= 10_000 {
            return number.formatted(style.notation(.compactName).precision(.significantDigits(1...3)))
        }
        return number.formatted(style.precision(.fractionLength(2)))
    }
}

enum WatchCopy {
    static func text(_ en: String, _ zh: String) -> String {
        Locale.preferredLanguages.first?.hasPrefix("zh") == true ? zh : en
    }
    static var title: String { text("Today’s spending", "今日支出") }
}

enum SpendState {
    case unpaired, unavailable, unsynced, value(Spending, offline: Bool)

    func hasSameDisplay(as other: SpendState) -> Bool {
        switch (self, other) {
        case (.unpaired, .unpaired), (.unavailable, .unavailable), (.unsynced, .unsynced): return true
        case let (.value(a, aOffline), .value(b, bOffline)):
            return a.date == b.date && a.timeZoneIdentifier == b.timeZoneIdentifier &&
                a.currency == b.currency && a.amount == b.amount && aOffline == bOffline
        default: return false
        }
    }

    var hint: String {
        switch self {
        case .unpaired: return WatchCopy.text("Pair in dayfly", "打开 dayfly 配对")
        case .unsynced: return WatchCopy.text("Sync your ledger", "请先同步网站账本")
        case .unavailable: return WatchCopy.text("Awaiting update", "等待更新")
        case .value(_, let offline): return offline ? WatchCopy.text("Last known", "上次同步") : WatchCopy.text("Updated", "更新于")
        }
    }
}

// Both the app and the complication use the same device-only keychain group.
// Cache entries are namespaced by origin and credential so re-pairing cannot expose an old total.
enum WatchStore {
    static var origin: URL { URL(string: Bundle.main.object(forInfoDictionaryKey: "DayflyServerURL") as! String)! }
    private static func query(_ account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: "dayfly.watch." + origin.absoluteString,
         kSecAttrAccount as String: account,
         kSecAttrAccessGroup as String: Bundle.main.object(forInfoDictionaryKey: "DayflyKeychainGroup") as! String]
    }
    private static func data(_ account: String) -> Data? {
        var q = query(account)
        q[kSecReturnData as String] = true
        var value: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &value) == errSecSuccess else { return nil }
        return value as? Data
    }
    private static func write(_ bytes: Data, to account: String) throws {
        let q = query(account)
        var value: [String: Any] = [kSecValueData as String: bytes,
                                    kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        var status = SecItemUpdate(q as CFDictionary, value as CFDictionary)
        if status == errSecItemNotFound {
            value.merge(q) { _, new in new }
            status = SecItemAdd(value as CFDictionary, nil)
        }
        if status != errSecSuccess { throw NSError(domain: NSOSStatusErrorDomain, code: Int(status)) }
    }
    static var token: String? { data("pairing").flatMap { String(data: $0, encoding: .utf8) } }
    private static func key(_ token: String) -> String {
        "total." + Data(SHA256.hash(data: Data(token.utf8))).base64EncodedString()
    }
    static func clearCached(_ token: String) { SecItemDelete(query(key(token)) as CFDictionary) }
    static func pair(_ token: String) throws {
        let old = self.token
        try write(Data(token.utf8), to: "pairing")
        if let old, old != token { clearCached(old) }
    }
    static func cached(_ token: String) -> Spending? {
        data(key(token)).flatMap { try? JSONDecoder().decode(Spending.self, from: $0) }
    }
    static func save(_ value: Spending, token: String) throws {
        try write(JSONEncoder().encode(value), to: key(token))
    }

    #if DAYFLY_WIDGET_PUSH
    static func syncWidgetPush(_ device: Data?) async {
        guard let token else { return }
        let hex = device?.map { String(format: "%02x", $0) }.joined()
        let receipt = "widget-push." + key(token)
        let desired = Data((hex ?? "").utf8)
        guard data(receipt) != desired else { return }
        var request = URLRequest(url: origin.appendingPathComponent("api/watch/widget-push"))
        request.httpMethod = hex == nil ? "DELETE" : "PUT"
        request.timeoutInterval = 8
        request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        if let hex {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try? JSONEncoder().encode(["deviceToken": hex])
        }
        if let (_, response) = try? await URLSession.shared.data(for: request),
           (response as? HTTPURLResponse)?.statusCode == 200, self.token == token {
            try? write(desired, to: receipt)
        }
    }
    #endif
}

enum WatchAPI {
    static func pair(code: String) async throws {
        var request = URLRequest(url: WatchStore.origin.appendingPathComponent("api/watch/redeem"))
        request.httpMethod = "POST"
        request.timeoutInterval = 18
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["code": code])
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw URLError((response as? HTTPURLResponse)?.statusCode == 401 ? .userAuthenticationRequired : .badServerResponse)
        }
        struct Credential: Decodable { let token: String }
        let credential = try JSONDecoder().decode(Credential.self, from: data)
        guard credential.token.range(of: #"^dfw_[a-zA-Z0-9_-]{43}$"#, options: .regularExpression) != nil else { throw URLError(.cannotParseResponse) }
        try WatchStore.pair(credential.token)
    }

    static func cachedState() -> SpendState {
        guard let token = WatchStore.token else { return .unpaired }
        if let value = WatchStore.cached(token), value.matches(Date()) { return .value(value, offline: true) }
        return .unavailable
    }

    static func refresh(waitForChanges: Bool = false) async -> SpendState {
        guard let token = WatchStore.token else { return .unpaired }
        var url = URLComponents(url: WatchStore.origin.appendingPathComponent("api/watch/today"), resolvingAgainstBaseURL: false)!
        let requestZone = TimeZone.current.identifier
        url.queryItems = [URLQueryItem(name: "timeZone", value: requestZone)]
        let previous = WatchStore.cached(token)
        let tag = waitForChanges && previous?.matches(Date()) == true ? previous?.changeTag : nil
        var request = URLRequest(url: url.url!, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: tag == nil ? 20 : 35)
        request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        request.setValue(tag, forHTTPHeaderField: "X-Dayfly-Watch-Since")
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            try Task.checkCancellation()
            guard token == WatchStore.token else { return cachedState() }
            let status = (response as? HTTPURLResponse)?.statusCode
            if status == 401 || status == 409 {
                WatchStore.clearCached(token)
                return status == 401 ? .unpaired : .unsynced
            }
            guard status == 200 else { throw URLError(.badServerResponse) }
            var value = try JSONDecoder().decode(Spending.self, from: data)
            value.timeZoneIdentifier = requestZone
            value.changeTag = (response as? HTTPURLResponse)?.value(forHTTPHeaderField: "X-Dayfly-Watch-Tag")
            guard value.matches(Date()), value.checkedAt.isFinite,
                  value.currency.range(of: #"^[A-Z]{3}$"#, options: .regularExpression) != nil,
                  value.amount.range(of: #"^[0-9]+\.[0-9]{2}$"#, options: .regularExpression) != nil else {
                throw URLError(.cannotParseResponse)
            }
            // Prefer a newer result if the app and the widget refreshed concurrently.
            if let saved = WatchStore.cached(token), saved.matches(Date()), saved.checkedAt > value.checkedAt {
                return .value(saved, offline: false)
            }
            try? WatchStore.save(value, token: token)
            return .value(value, offline: false)
        } catch { return cachedState() }
    }
}
