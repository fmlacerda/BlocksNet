import Foundation
import Capacitor
import AuthenticationServices

// Google and Microsoft sign in through their web pages. Inside the app those pages open in
// ASWebAuthenticationSession (Apple's sign-in sheet, which shares Safari's sign-ins); the
// session ends when the page goes to a rowbusters:// address, which is handed back to the game.
@objc(WebSignInPlugin)
public class WebSignInPlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding {
    public let identifier = "WebSignInPlugin"
    public let jsName = "WebSignIn"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise)
    ]
    private var session: ASWebAuthenticationSession?

    @objc func open(_ call: CAPPluginCall) {
        guard let address = call.getString("url"), let url = URL(string: address), url.scheme == "https",
              let scheme = call.getString("callbackScheme") else {
            call.reject("bad arguments")
            return
        }
        DispatchQueue.main.async {
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme) { [weak self] callbackURL, error in
                self?.session = nil
                if let callbackURL = callbackURL {
                    call.resolve(["url": callbackURL.absoluteString])
                } else if (error as NSError?)?.code == ASWebAuthenticationSessionError.Code.canceledLogin.rawValue {
                    call.reject("cancelled", "cancelled")
                } else {
                    call.reject(error?.localizedDescription ?? "failed")
                }
            }
            session.presentationContextProvider = self
            self.session = session
            if !session.start() {
                self.session = nil
                call.reject("failed")
            }
        }
    }

    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        return bridge?.webView?.window ?? ASPresentationAnchor()
    }
}
