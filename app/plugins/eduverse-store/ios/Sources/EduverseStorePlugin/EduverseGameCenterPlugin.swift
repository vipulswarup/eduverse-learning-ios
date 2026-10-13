import Foundation
import Capacitor
import GameKit

/// Game Center: sign-in, friends, adding friends and a weekly XP leaderboard.
/// Apple runs the friend system, nicknames, reporting and parental controls (Screen Time),
/// so EduVerse never stores who is friends with whom.
@objc(EduverseGameCenterPlugin)
public class EduverseGameCenterPlugin: CAPPlugin, CAPBridgedPlugin, GKGameCenterControllerDelegate {
    public let identifier = "EduverseGameCenterPlugin"
    public let jsName = "EduverseGameCenter"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "signIn", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "friends", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "submitScore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "friendScores", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "addFriends", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openDashboard", returnType: CAPPluginReturnPromise)
    ]

    private func info() -> [String: Any] {
        let p = GKLocalPlayer.local
        var d: [String: Any] = ["authenticated": p.isAuthenticated, "name": p.isAuthenticated ? p.displayName : ""]
        d["underage"] = p.isUnderage
        d["multiplayerRestricted"] = p.isMultiplayerGamingRestricted
        if #available(iOS 14.0, *) { d["communicationRestricted"] = p.isPersonalizedCommunicationRestricted }
        return d
    }

    @objc func status(_ call: CAPPluginCall) { call.resolve(info()) }

    @objc func signIn(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let p = GKLocalPlayer.local
            if p.isAuthenticated { return call.resolve(self.info()) }
            var answered = false
            p.authenticateHandler = { [weak self] vc, _ in
                guard let self = self else { return }
                if let vc = vc { self.bridge?.viewController?.present(vc, animated: true); return }
                if answered { return }
                answered = true
                if p.isAuthenticated { call.resolve(self.info()) }
                else { call.reject("Sign in to Game Center to see your friends.", "not_signed_in") }
            }
        }
    }

    @objc func friends(_ call: CAPPluginCall) {
        Task {
            do {
                let p = GKLocalPlayer.local
                guard p.isAuthenticated else { return call.reject("Sign in to Game Center first.", "not_signed_in") }
                let auth = try await p.loadFriendsAuthorizationStatus()
                if auth == .denied || auth == .restricted { return call.resolve(["friends": [], "access": "denied"]) }
                let list = try await p.loadFriends()
                call.resolve(["friends": list.map { ["id": $0.gamePlayerID, "name": $0.displayName] }, "access": "ok"])
            } catch {
                call.reject("Couldn't load your friends.", "friends_error", error)
            }
        }
    }

    @objc func submitScore(_ call: CAPPluginCall) {
        guard let id = call.getString("leaderboard") else { return call.reject("leaderboard is required") }
        let score = call.getInt("score") ?? 0
        Task {
            do {
                guard GKLocalPlayer.local.isAuthenticated else { return call.resolve(["submitted": false]) }
                try await GKLeaderboard.submitScore(score, context: 0, player: GKLocalPlayer.local, leaderboardIDs: [id])
                call.resolve(["submitted": true])
            } catch {
                call.reject("Couldn't send your score.", "score_error", error)
            }
        }
    }

    @objc func friendScores(_ call: CAPPluginCall) {
        guard let id = call.getString("leaderboard") else { return call.reject("leaderboard is required") }
        Task {
            do {
                let me = GKLocalPlayer.local
                guard me.isAuthenticated else { return call.reject("Sign in to Game Center first.", "not_signed_in") }
                guard let board = try await GKLeaderboard.loadLeaderboards(IDs: [id]).first else { return call.resolve(["entries": []]) }
                let (local, entries, _) = try await board.loadEntries(for: .friendsOnly, timeScope: .allTime, range: NSRange(location: 1, length: 50))
                var out = entries.map { e -> [String: Any] in
                    ["name": e.player.displayName, "score": e.score, "rank": e.rank, "me": e.player.gamePlayerID == me.gamePlayerID]
                }
                if let l = local, !entries.contains(where: { $0.player.gamePlayerID == me.gamePlayerID }) {
                    out.append(["name": l.player.displayName, "score": l.score, "rank": l.rank, "me": true])
                }
                call.resolve(["entries": out])
            } catch {
                call.reject("Couldn't load the leaderboard.", "board_error", error)
            }
        }
    }

    @objc func addFriends(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let vc = self.bridge?.viewController else { return call.reject("No screen to show.") }
            do { try GKLocalPlayer.local.presentFriendRequestCreator(from: vc); call.resolve() }
            catch { call.reject("Couldn't open Add Friends.", "friends_error", error) }
        }
    }

    @objc func openDashboard(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let vc = self.bridge?.viewController else { return call.reject("No screen to show.") }
            let gc: GKGameCenterViewController
            if #available(iOS 14.0, *) { gc = GKGameCenterViewController(state: .dashboard) } else { gc = GKGameCenterViewController() }
            gc.gameCenterDelegate = self
            vc.present(gc, animated: true)
            call.resolve()
        }
    }

    public func gameCenterViewControllerDidFinish(_ gameCenterViewController: GKGameCenterViewController) {
        gameCenterViewController.dismiss(animated: true)
    }
}
