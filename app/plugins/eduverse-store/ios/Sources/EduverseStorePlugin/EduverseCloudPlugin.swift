import Foundation
import Capacitor
import CloudKit

/// Keeps one copy of the learner's progress in their own iCloud (CloudKit private database).
/// Only the learner's Apple ID can read it; the developer cannot. Every iPhone or iPad signed in to the
/// same Apple ID gets the same progress. The web layer merges and decides what to save.
@objc(EduverseCloudPlugin)
public class EduverseCloudPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "EduverseCloudPlugin"
    public let jsName = "EduverseCloud"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "load", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "save", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise)
    ]

    private lazy var container = CKContainer.default()     // iCloud.<bundle id>
    private var db: CKDatabase { container.privateCloudDatabase }
    private let recordID = CKRecord.ID(recordName: "progress")

    private static func name(_ s: CKAccountStatus) -> String {
        switch s {
        case .available: return "available"
        case .noAccount: return "noAccount"
        case .restricted: return "restricted"
        case .couldNotDetermine: return "unknown"
        case .temporarilyUnavailable: return "temporarilyUnavailable"
        @unknown default: return "unknown"
        }
    }
    private static func millis(_ d: Date?) -> Int { Int(((d ?? Date()).timeIntervalSince1970 * 1000).rounded()) }

    @objc func status(_ call: CAPPluginCall) {
        Task {
            do {
                let s = try await container.accountStatus()
                call.resolve(["available": s == .available, "status": Self.name(s)])
            } catch {
                call.resolve(["available": false, "status": "unknown"])
            }
        }
    }

    @objc func load(_ call: CAPPluginCall) {
        Task {
            do {
                let r = try await db.record(for: recordID)
                var json = ""
                if let a = r["data"] as? CKAsset, let u = a.fileURL { json = (try? String(contentsOf: u, encoding: .utf8)) ?? "" }
                call.resolve(["json": json, "modified": Self.millis(r.modificationDate)])
            } catch let e as CKError where e.code == .unknownItem {
                call.resolve(["json": NSNull(), "modified": 0])
            } catch let e as CKError where e.code == .notAuthenticated {
                call.reject("Sign in to iCloud in the Settings app to sync.", "not_signed_in")
            } catch {
                call.reject("Couldn't reach iCloud.", "cloud_error", error)
            }
        }
    }

    @objc func save(_ call: CAPPluginCall) {
        guard let json = call.getString("json"), let data = json.data(using: .utf8) else { return call.reject("json is required") }
        Task {
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".json")
            defer { try? FileManager.default.removeItem(at: url) }
            do {
                var record: CKRecord
                do { record = try await db.record(for: recordID) }
                catch let e as CKError where e.code == .unknownItem { record = CKRecord(recordType: "Progress", recordID: recordID) }
                try data.write(to: url)
                record["data"] = CKAsset(fileURL: url)
                record["updatedAt"] = Date() as NSDate
                let saved = try await db.save(record)
                call.resolve(["modified": Self.millis(saved.modificationDate)])
            } catch let e as CKError where e.code == .serverRecordChanged {
                call.reject("Another device saved first.", "conflict")
            } catch let e as CKError where e.code == .notAuthenticated {
                call.reject("Sign in to iCloud in the Settings app to sync.", "not_signed_in")
            } catch let e as CKError where e.code == .quotaExceeded {
                call.reject("Your iCloud storage is full.", "quota")
            } catch {
                call.reject("Couldn't save to iCloud.", "cloud_error", error)
            }
        }
    }

    @objc func remove(_ call: CAPPluginCall) {
        Task {
            _ = try? await db.deleteRecord(withID: recordID)
            call.resolve()
        }
    }
}
