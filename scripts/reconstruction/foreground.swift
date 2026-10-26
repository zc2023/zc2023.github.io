// Use macOS Vision's foreground-instance masks for the reviewed car crops.
// Usage: swift foreground.swift CROPS_DIRECTORY MASKS_DIRECTORY
import Foundation
import Vision
import CoreImage
import ImageIO

let source = URL(fileURLWithPath: CommandLine.arguments[1])
let destination = URL(fileURLWithPath: CommandLine.arguments[2])
try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
let context = CIContext()
let files = try FileManager.default.contentsOfDirectory(at: source, includingPropertiesForKeys: nil)
    .filter { $0.pathExtension.lowercased() == "jpg" }.sorted { $0.lastPathComponent < $1.lastPathComponent }
for input in files {
    try autoreleasepool {
        let handler = VNImageRequestHandler(url: input, options: [:])
        let request = VNGenerateForegroundInstanceMaskRequest()
        try handler.perform([request])
        guard let observation = request.results?.first, !observation.allInstances.isEmpty else {
            throw NSError(domain: "Foreground", code: 1, userInfo: [NSLocalizedDescriptionKey: "No subject in \(input.lastPathComponent)"])
        }
        let buffer = try observation.generateScaledMaskForImage(forInstances: observation.allInstances, from: handler)
        let image = CIImage(cvPixelBuffer: buffer)
        let output = destination.appendingPathComponent(input.deletingPathExtension().lastPathComponent + ".png")
        try context.writePNGRepresentation(of: image, to: output, format: .L8, colorSpace: CGColorSpaceCreateDeviceGray())
        print(input.lastPathComponent, "instances", observation.allInstances.count)
    }
}
