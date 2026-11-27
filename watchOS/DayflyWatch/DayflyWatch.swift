import SwiftUI
import WidgetKit

@main
struct DayflyWatch: App {
    var body: some Scene { WindowGroup { SpendingScreen() } }
}

private struct SpendingScreen: View {
    @Environment(\.scenePhase) private var phase
    @State private var state = WatchAPI.cachedState()
    @State private var code = ""
    @State private var pairingMessage = ""
    @State private var busy = false
    @State private var refreshID = UUID()

    var body: some View {
        NavigationStack {
            TimelineView(.periodic(from: .now, by: 60)) { clock in
                ScrollView {
                    VStack(alignment: .leading, spacing: 8) {
                        if case .unpaired = state {
                            Text(WatchCopy.text("Get a pairing code in your dayfly ledger under Budget settings → Apple Watch.", "在网站账本的「预算设置 → Apple Watch」生成配对码。"))
                                .font(.footnote)
                            TextField(WatchCopy.text("Pairing code", "配对码"), text: $code)
                                .autocorrectionDisabled()
                            if !pairingMessage.isEmpty { Text(pairingMessage).font(.caption) }
                            Button(WatchCopy.text("Pair watch", "配对手表")) { Task { await pair() } }
                                .disabled(busy || code.filter(\.isHexDigit).count != 10)
                        } else {
                            if case .value(let value, _) = state, value.matches(clock.date) {
                                Text(value.currency).font(.caption).foregroundStyle(.secondary)
                                Text(verbatim: value.displayAmount()).font(.largeTitle.weight(.semibold)).monospacedDigit()
                                    .lineLimit(1).minimumScaleFactor(0.45).privacySensitive()
                                Text("\(state.hint) \(value.updated.formatted(date: .omitted, time: .shortened))")
                                    .font(.footnote).foregroundStyle(.secondary)
                            } else {
                                Text("—").font(.largeTitle)
                                Text(stateHint).font(.footnote).foregroundStyle(.secondary)
                            }
                            Button(WatchCopy.text("Refresh", "刷新")) { refreshID = UUID() }
                                .disabled(busy)
                        }
                        if busy { ProgressView() }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .task(id: phase == .active ? Spending.day(clock.date) + refreshID.uuidString : "") {
                    if phase == .active { await observeSpending() }
                }
            }
            .navigationTitle(WatchCopy.title)
        }
    }

    private var stateHint: String {
        if case .value = state { return SpendState.unavailable.hint }
        return state.hint
    }

    @MainActor private func observeSpending() async {
        var canWait = false
        var firstRead = true
        while !Task.isCancelled {
            let next = await WatchAPI.refresh(waitForChanges: canWait)
            guard !Task.isCancelled else { return }
            let previous = state
            state = next
            if firstRead || !previous.hasSameDisplay(as: next) {
                WidgetCenter.shared.reloadTimelines(ofKind: "DayflySpending")
            }
            firstRead = false
            if case .unpaired = next { return }
            if case .value(let value, offline: false) = next {
                canWait = value.changeTag != nil
            } else { canWait = false }
            do { try await Task.sleep(for: .seconds(canWait ? 1 : 12)) }
            catch { return }
        }
    }

    @MainActor private func pair() async {
        guard !busy else { return }
        busy = true
        pairingMessage = ""
        defer { busy = false }
        do {
            try await WatchAPI.pair(code: code)
            code = ""
            refreshID = UUID()
        } catch let failure as URLError where failure.code == .userAuthenticationRequired {
            pairingMessage = WatchCopy.text("Code expired or already used. Get a new code.", "配对码已过期或已使用，请重新生成。")
        } catch {
            pairingMessage = WatchCopy.text("Couldn’t pair. Check your connection and try again.", "未能配对，请检查网络后重试。")
        }
    }
}
