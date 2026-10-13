import Foundation
import Capacitor
import StoreKit

/// Thin StoreKit 2 wrapper: loads prices, buys, restores, and reports which subscriptions are active.
@objc(EduverseStorePlugin)
public class EduverseStorePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "EduverseStorePlugin"
    public let jsName = "EduverseStore"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "products", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "entitlements", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restore", returnType: CAPPluginReturnPromise)
    ]

    private var updatesTask: Task<Void, Never>?

    override public func load() {
        // Renewals, Ask to Buy approvals and purchases made outside the app arrive here.
        updatesTask = Task.detached { [weak self] in
            for await result in Transaction.updates {
                if case .verified(let transaction) = result {
                    await transaction.finish()
                    self?.notifyListeners("transactionUpdate", data: ["productId": transaction.productID])
                }
            }
        }
    }

    deinit { updatesTask?.cancel() }

    private static func describe(_ period: Product.SubscriptionPeriod) -> String {
        switch period.unit {
        case .day: return period.value == 7 ? "weekly" : "every \(period.value) days"
        case .week: return period.value == 1 ? "weekly" : "every \(period.value) weeks"
        case .month: return period.value == 1 ? "monthly" : "every \(period.value) months"
        case .year: return period.value == 1 ? "yearly" : "every \(period.value) years"
        @unknown default: return ""
        }
    }

    /// Active subscriptions, checked by StoreKit on the device (Apple signs every transaction).
    /// There is no EduVerse server, so the app trusts StoreKit's own verification.
    private func activeProducts() async -> [String] {
        var out: [String] = []
        for await result in Transaction.currentEntitlements {
            guard case .verified(let t) = result else { continue }
            if t.revocationDate != nil { continue }
            if let exp = t.expirationDate, exp < Date() { continue }
            out.append(t.productID)
        }
        return out
    }

    @objc func products(_ call: CAPPluginCall) {
        guard let ids = call.getArray("ids", String.self), !ids.isEmpty else {
            call.reject("ids is required")
            return
        }
        Task {
            do {
                let found = try await Product.products(for: ids)
                let list: [[String: Any]] = found.map { p in
                    var period = ""
                    if let sub = p.subscription { period = EduverseStorePlugin.describe(sub.subscriptionPeriod) }
                    return ["id": p.id, "displayName": p.displayName, "description": p.description, "displayPrice": p.displayPrice, "period": period]
                }
                call.resolve(["products": list])
            } catch {
                call.reject("Couldn't load prices. Check your connection.", nil, error)
            }
        }
    }

    @objc func purchase(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else {
            call.reject("id is required")
            return
        }
        Task {
            do {
                guard let product = try await Product.products(for: [id]).first else {
                    call.reject("That plan isn't available right now.")
                    return
                }
                let result = try await product.purchase()
                switch result {
                case .success(let verification):
                    switch verification {
                    case .verified(let transaction):
                        await transaction.finish()
                        call.resolve(["status": "success", "productId": transaction.productID])
                    case .unverified:
                        call.reject("The purchase couldn't be verified.")
                    }
                case .userCancelled:
                    call.resolve(["status": "cancelled"])
                case .pending:
                    call.resolve(["status": "pending"])
                @unknown default:
                    call.reject("The purchase didn't go through.")
                }
            } catch {
                call.reject("The purchase didn't go through.", nil, error)
            }
        }
    }

    @objc func entitlements(_ call: CAPPluginCall) {
        Task {
            call.resolve(["active": await activeProducts()])
        }
    }

    @objc func restore(_ call: CAPPluginCall) {
        Task {
            do {
                try await AppStore.sync()
            } catch {
                // Keep going: current entitlements may still be readable.
            }
            call.resolve(["active": await activeProducts()])
        }
    }
}
