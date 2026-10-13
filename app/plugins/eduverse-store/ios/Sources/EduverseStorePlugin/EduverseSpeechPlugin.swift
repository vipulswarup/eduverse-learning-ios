import Foundation
import Capacitor
import Speech
import AVFoundation

/// Listens for one short phrase and returns the recognised text. Apple does the recognition
/// (on the device when the language supports it). EduVerse never receives or stores audio.
@objc(EduverseSpeechPlugin)
public class EduverseSpeechPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "EduverseSpeechPlugin"
    public let jsName = "EduverseSpeech"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "listen", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]

    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var pending: CAPPluginCall?
    private var timer: Timer?
    private var best: [String] = []

    private func finish(_ alternatives: [String]) {
        timer?.invalidate(); timer = nil
        if engine.isRunning { engine.stop(); engine.inputNode.removeTap(onBus: 0) }
        request?.endAudio(); request = nil
        task?.cancel(); task = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        let call = pending; pending = nil
        call?.resolve(["alternatives": alternatives])
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.finish(self.best); call.resolve() }
    }

    @objc func listen(_ call: CAPPluginCall) {
        let lang = call.getString("lang") ?? "en-US"
        let ms = call.getDouble("ms") ?? 9000
        SFSpeechRecognizer.requestAuthorization { status in
            guard status == .authorized else { return call.reject("denied") }
            AVAudioSession.sharedInstance().requestRecordPermission { ok in
                guard ok else { return call.reject("denied") }
                DispatchQueue.main.async { self.begin(call, lang: lang, ms: ms) }
            }
        }
    }

    private func begin(_ call: CAPPluginCall, lang: String, ms: Double) {
        if pending != nil { finish(best) }
        guard let rec = SFSpeechRecognizer(locale: Locale(identifier: lang)), rec.isAvailable else {
            return call.reject("unavailable")
        }
        best = []
        pending = call
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playAndRecord, mode: .measurement, options: [.duckOthers, .defaultToSpeaker])
            try session.setActive(true, options: .notifyOthersOnDeactivation)
            let req = SFSpeechAudioBufferRecognitionRequest()
            req.shouldReportPartialResults = true
            if rec.supportsOnDeviceRecognition { req.requiresOnDeviceRecognition = true }
            request = req
            let input = engine.inputNode
            input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { buf, _ in req.append(buf) }
            engine.prepare()
            try engine.start()
            task = rec.recognitionTask(with: req) { [weak self] result, error in
                guard let self = self else { return }
                if let result = result {
                    self.best = result.transcriptions.prefix(4).map { $0.formattedString }
                    if result.isFinal { self.finish(self.best) }
                } else if error != nil {
                    self.finish(self.best)
                }
            }
            // Stop a moment after the learner goes quiet, or at the time limit.
            timer = Timer.scheduledTimer(withTimeInterval: ms / 1000.0, repeats: false) { [weak self] _ in
                guard let self = self else { return }
                self.finish(self.best)
            }
        } catch {
            finish([])
            call.reject("start")
        }
    }
}
