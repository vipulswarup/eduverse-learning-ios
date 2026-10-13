import Foundation
import Capacitor
#if canImport(FoundationModels)
import FoundationModels
#endif

/// Apple Intelligence on the device (iOS 26+, Apple Intelligence-capable iPhones).
/// Free to run, works offline, and nothing leaves the phone. The web layer decides when to use it
/// and falls back to the EduVerse server (Claude) when it is unavailable or the answer doesn't fit.
@objc(EduverseAIPlugin)
public class EduverseAIPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "EduverseAIPlugin"
    public let jsName = "EduverseAI"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "generate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise)
    ]

    private var current: Task<Void, Never>?

    @objc func status(_ call: CAPPluginCall) {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            let model = SystemLanguageModel.default
            if case .available = model.availability {
                let langs = model.supportedLanguages.compactMap { $0.languageCode?.identifier }
                call.resolve(["available": true, "languages": Array(Set(langs))])
            } else {
                call.resolve(["available": false, "reason": String(describing: model.availability)])
            }
            return
        }
        #endif
        call.resolve(["available": false, "reason": "needs iOS 26 with Apple Intelligence"])
    }

    @objc func cancel(_ call: CAPPluginCall) {
        current?.cancel(); current = nil
        call.resolve()
    }

    @objc func generate(_ call: CAPPluginCall) {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            let prompt = call.getString("prompt") ?? ""
            let instructions = call.getString("instructions") ?? ""
            let maxTokens = call.getInt("maxTokens") ?? 1500
            let temperature = call.getDouble("temperature") ?? 0.6
            current?.cancel()
            current = Task {
                do {
                    let session = LanguageModelSession(instructions: { instructions })
                    let options = GenerationOptions(temperature: temperature, maximumResponseTokens: maxTokens)
                    let response = try await session.respond(to: prompt, options: options)
                    if Task.isCancelled { return call.reject("cancelled") }
                    call.resolve(["text": response.content])
                } catch let e as LanguageModelSession.GenerationError {
                    switch e {
                    case .guardrailViolation: call.reject("guardrail")
                    case .exceededContextWindowSize: call.reject("too_long")
                    case .unsupportedLanguageOrLocale: call.reject("language")
                    default: call.reject("failed")
                    }
                } catch {
                    call.reject(Task.isCancelled ? "cancelled" : "failed")
                }
            }
            return
        }
        #endif
        call.reject("unavailable")
    }
}
