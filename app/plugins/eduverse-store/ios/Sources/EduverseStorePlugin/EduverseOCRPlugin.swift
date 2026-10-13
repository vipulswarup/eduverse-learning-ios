import Foundation
import Capacitor
import Vision
import UIKit

/// Reads the text in a homework photo on the iPhone (Apple Vision), so only text is sent to the AI.
/// The photo itself never leaves the device.
@objc(EduverseOCRPlugin)
public class EduverseOCRPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "EduverseOCRPlugin"
    public let jsName = "EduverseOCR"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "recognize", returnType: CAPPluginReturnPromise)
    ]

    @objc func recognize(_ call: CAPPluginCall) {
        guard let b64 = call.getString("data"), let data = Data(base64Encoded: b64),
              let image = UIImage(data: data), let cg = image.cgImage else {
            return call.reject("That photo couldn't be read.", "bad_image")
        }
        let langs = call.getArray("languages", String.self) ?? []
        DispatchQueue.global(qos: .userInitiated).async {
            let request = VNRecognizeTextRequest { req, error in
                if error != nil { return call.reject("Couldn't read the photo.", "ocr_failed") }
                let lines = (req.results as? [VNRecognizedTextObservation])?.compactMap { $0.topCandidates(1).first?.string } ?? []
                call.resolve(["text": lines.joined(separator: "\n")])
            }
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = true
            if !langs.isEmpty { request.recognitionLanguages = langs }
            if #available(iOS 16.0, *) { request.automaticallyDetectsLanguage = langs.isEmpty }
            do { try VNImageRequestHandler(cgImage: cg, options: [:]).perform([request]) }
            catch { call.reject("Couldn't read the photo.", "ocr_failed") }
        }
    }
}
