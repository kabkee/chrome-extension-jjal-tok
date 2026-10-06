// 짤톡 Native Messaging 도우미 (JjalTok Helper.app)
//
// Firefox/Zen의 확장용 downloads API는 "이번 브라우저 세션에 받은 파일"만 보여주고,
// Finder에서 지운 것도 바로 알지 못한다. 이 도우미가 경로 기준으로 대신 확인·삭제한다.
//
// 왜 스크립트가 아니라 앱인가:
//   macOS는 ~/Downloads 접근을 "어떤 앱이 하는가"로 허용한다(TCC). Zen이 실행한 도우미는
//   Zen의 권한을 물려받지 못하고 자기 이름으로 검사받는다. python 스크립트면 python3 자체에
//   권한을 줘야 하므로, 짤톡 전용 앱으로 만들어 이 앱에만 '다운로드 폴더' 권한을 받는다.
//
// - jjal-tok 폴더 바로 아래 파일만 다룬다. (다른 경로는 null/거부)
// - 파일을 새로 만들지 않는다.
//
// 프로토콜: stdin/stdout, 4바이트 길이(native byte order) + UTF-8 JSON
//   {"action": "ping"}                          → {"ok": true, "version": 4}
//   {"action": "exists", "paths": [...]}        → {"ok": true, "results": {경로: true|false|null}}
//   {"action": "list", "path": ".../jjal-tok"}  → {"ok": true, "folder": ..., "files": [...]}
//   {"action": "delete", "paths": [...]}        → {"ok": true, "results": {경로: true|false|null}}
//   {"action": "reveal", "path": "..."}         → {"ok": true|false}  (Finder에서 파일 선택)
//   {"action": "openFolder", "path": ... }      → {"ok": true|false}
//   {"action": "sourceUrl", "paths": [...]}     → {"ok": true, "results": {경로: "https://..."|null}}
//      (macOS가 다운로드 파일에 기록해 둔 출처 kMDItemWhereFroms)
//   폴더 path가 없거나 jjal-tok 폴더가 아니면 ~/Downloads/jjal-tok 을 쓴다.
//   macOS 권한 문제면 {"ok": false, "error": "permission"}
//
// 설치 스크립트는 `--request-access`로 한 번 실행해 macOS 권한 요청 창을 미리 띄운다.

import Foundation

let version = 5
let folderName = "jjal-tok"
let home = ProcessInfo.processInfo.environment["HOME"] ?? NSHomeDirectory()
let logPath = home + "/Library/Logs/JjalTok/host.log"

struct PermissionDenied: Error {
    let detail: String
}

// 문제 확인용 로그. 실패해도 동작에는 영향 없음. (200KB 넘으면 .old로 돌림)
func log(_ text: String) {
    let fm = FileManager.default
    try? fm.createDirectory(atPath: (logPath as NSString).deletingLastPathComponent,
                            withIntermediateDirectories: true)
    if let size = (try? fm.attributesOfItem(atPath: logPath))?[.size] as? Int, size > 200 * 1024 {
        try? fm.removeItem(atPath: logPath + ".old")
        try? fm.moveItem(atPath: logPath, toPath: logPath + ".old")
    }
    let formatter = DateFormatter()
    formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
    let line = "\(formatter.string(from: Date())) pid=\(getpid()) [app] \(text)\n"
    if let handle = FileHandle(forWritingAtPath: logPath) {
        handle.seekToEndOfFile()
        handle.write(line.data(using: .utf8)!)
        handle.closeFile()
    } else {
        fm.createFile(atPath: logPath, contents: line.data(using: .utf8))
    }
}

func isPermissionError(_ error: Error) -> Bool {
    let ns = error as NSError
    if ns.domain == NSCocoaErrorDomain && (ns.code == NSFileReadNoPermissionError || ns.code == NSFileWriteNoPermissionError) {
        return true
    }
    if let underlying = ns.userInfo[NSUnderlyingErrorKey] as? NSError, underlying.domain == NSPOSIXErrorDomain {
        return underlying.code == Int(EPERM) || underlying.code == Int(EACCES)
    }
    return ns.domain == NSPOSIXErrorDomain && (ns.code == Int(EPERM) || ns.code == Int(EACCES))
}

func isJjalTokFile(_ path: Any?) -> Bool {
    guard let path = path as? String, path.hasPrefix("/") else { return false }
    let parent = ((path as NSString).standardizingPath as NSString).deletingLastPathComponent
    return (parent as NSString).lastPathComponent == folderName
}

func resolveFolder(_ path: Any?) -> String {
    if let path = path as? String, path.hasPrefix("/"),
       ((path as NSString).standardizingPath as NSString).lastPathComponent == folderName {
        return path
    }
    return home + "/Downloads/" + folderName
}

func isFile(_ path: String) -> Bool {
    var isDirectory: ObjCBool = false
    return FileManager.default.fileExists(atPath: path, isDirectory: &isDirectory) && !isDirectory.boolValue
}

func listFolder(_ folder: String) throws -> [String] {
    var isDirectory: ObjCBool = false
    guard FileManager.default.fileExists(atPath: folder, isDirectory: &isDirectory), isDirectory.boolValue else {
        return []
    }
    do {
        return try FileManager.default.contentsOfDirectory(atPath: folder)
            .filter { !$0.hasPrefix(".") }
            .sorted()
            .map { folder + "/" + $0 }
            .filter(isFile)
    } catch where isPermissionError(error) {
        throw PermissionDenied(detail: "\(error)")
    }
}

// 삭제했거나 이미 없으면 true, jjal-tok 파일이 아니면 nil
func deleteFile(_ path: Any?) throws -> Any {
    guard isJjalTokFile(path), let path = path as? String else { return NSNull() }
    do {
        try FileManager.default.removeItem(atPath: path)
    } catch let error as NSError where error.domain == NSCocoaErrorDomain && error.code == NSFileNoSuchFileError {
        // 이미 없으면 "삭제된 상태"이므로 성공
    } catch where isPermissionError(error) {
        throw PermissionDenied(detail: "\(error)")
    } catch {
        return false
    }
    return true
}

// macOS가 다운로드한 파일에 남기는 출처 URL (com.apple.metadata:kMDItemWhereFroms, binary plist)
func sourceURL(_ path: String) -> Any {
    guard isJjalTokFile(path) else { return NSNull() }
    let name = "com.apple.metadata:kMDItemWhereFroms"
    let size = getxattr(path, name, nil, 0, 0, 0)
    guard size > 0 else { return NSNull() }
    var data = Data(count: size)
    let read = data.withUnsafeMutableBytes { getxattr(path, name, $0.baseAddress, size, 0, 0) }
    guard read > 0,
          let list = try? PropertyListSerialization.propertyList(from: data.prefix(read), format: nil) as? [String],
          let url = list.first(where: { $0.hasPrefix("http://") || $0.hasPrefix("https://") }) else {
        return NSNull()
    }
    return url
}

func runOpen(_ arguments: [String]) -> Bool {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
    process.arguments = arguments
    do {
        try process.run()
        process.waitUntilExit()
        return process.terminationStatus == 0
    } catch {
        return false
    }
}

func handle(_ request: [String: Any]) throws -> [String: Any] {
    let action = request["action"] as? String ?? ""
    switch action {
    case "ping":
        return ["ok": true, "version": version]
    case "exists":
        var results: [String: Any] = [:]
        for case let path as String in request["paths"] as? [Any] ?? [] {
            results[path] = isJjalTokFile(path) ? isFile(path) : NSNull()
        }
        return ["ok": true, "results": results]
    case "list":
        let folder = resolveFolder(request["path"])
        return ["ok": true, "folder": folder, "files": try listFolder(folder)]
    case "delete":
        var results: [String: Any] = [:]
        for case let path as String in request["paths"] as? [Any] ?? [] {
            results[path] = try deleteFile(path)
        }
        return ["ok": true, "results": results]
    case "sourceUrl":
        var results: [String: Any] = [:]
        for case let path as String in request["paths"] as? [Any] ?? [] {
            results[path] = sourceURL(path)
        }
        return ["ok": true, "results": results]
    case "reveal":
        guard isJjalTokFile(request["path"]), let path = request["path"] as? String, isFile(path) else {
            return ["ok": false, "error": "file not found"]
        }
        return ["ok": runOpen(["-R", path])]
    case "openFolder":
        let folder = resolveFolder(request["path"])
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: folder, isDirectory: &isDirectory), isDirectory.boolValue else {
            return ["ok": false, "error": "folder not found: \(folder)"]
        }
        return ["ok": runOpen([folder])]
    default:
        return ["ok": false, "error": "unknown action: \(action)"]
    }
}

// ---------- Native Messaging 입출력 ----------

func readMessage() -> [String: Any]? {
    let stdin = FileHandle.standardInput
    let lengthData = stdin.readData(ofLength: 4)
    guard lengthData.count == 4 else { return nil }
    let length = lengthData.withUnsafeBytes { $0.loadUnaligned(as: UInt32.self) }
    let body = stdin.readData(ofLength: Int(length))
    return (try? JSONSerialization.jsonObject(with: body)) as? [String: Any] ?? [:]
}

func sendMessage(_ message: [String: Any]) {
    guard let body = try? JSONSerialization.data(withJSONObject: message) else { return }
    var length = UInt32(body.count)
    let stdout = FileHandle.standardOutput
    stdout.write(Data(bytes: &length, count: 4))
    stdout.write(body)
}

// 설치 직후: 다운로드 폴더를 한 번 읽어서 macOS 권한 요청 창을 띄운다. (결과는 로그로 남김)
if CommandLine.arguments.contains("--request-access") {
    let folder = resolveFolder(nil)
    do {
        let files = try listFolder(folder)
        log("request-access -> ok (\(files.count) files)")
    } catch {
        log("request-access -> PERMISSION \(error)")
    }
    exit(0)
}

while let request = readMessage() {
    let action = request["action"] as? String ?? "?"
    do {
        let response = try handle(request)
        log("\(action) -> \((response["ok"] as? Bool) == true ? "ok" : "\(response["error"] ?? "fail")")")
        sendMessage(response)
    } catch let error as PermissionDenied {
        log("\(action) -> PERMISSION \(error.detail)")
        sendMessage(["ok": false, "error": "permission", "detail": error.detail])
    } catch {
        log("\(action) -> ERROR \(error)")
        sendMessage(["ok": false, "error": "\(error)"])
    }
}
