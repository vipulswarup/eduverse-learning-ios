# EduVerse for the App Store (no server)

This folder turns the EduVerse web app into an iPhone app. There is **no EduVerse server** to run or pay for.

```
eduverse-ios/
  app/          The iPhone app: a Capacitor shell around the EduVerse web app + Swift plugins.
  legal-site/   Privacy Policy, Terms and Help pages. Host them free on GitHub Pages (step 2).
  README.md     This file.
```

## How it works

| Job | Who does it | Cost |
|---|---|---|
| AI (lessons, games, Drift, homework help) | 1. **Apple Intelligence** on the iPhone when it can (iOS 26, iPhone 15 Pro and newer). 2. Otherwise **Groq** (open GPT-OSS models) over the internet, called straight from the app. | Groq free plan (no card) |
| Homework photos | **Apple Vision** reads the words on the phone. Only the text goes to the AI; the photo never leaves the phone. | Free |
| Saving progress, using several devices | The learner's own **iCloud** (CloudKit private database). Every iPhone/iPad on the same Apple ID gets the same courses and XP. | Free (comes with the Apple Developer Program) |
| Friends, friend requests, weekly leaderboard | **Game Center** (Apple's friend system, nicknames, reporting and Screen Time parental controls). | Free |
| Challenge a friend | A self-contained code inside the message. Nothing stored anywhere. | Free |
| EduVerse Pro subscription | **StoreKit 2**, checked on the iPhone. | Apple's commission |
| Privacy Policy, Terms, Help pages | **GitHub Pages**. | Free |

Routing lives in `app/www-src/native-shim.js` (`route()`): this phone's own lesson cache → Apple Intelligence → Groq. If Groq's big model is at its per-minute limit, the app retries on the small, faster model. Free learners get 25 online AI helps a day, Pro 150 (`config.json`). Apple Intelligence answers don't count.

### Know the trade-offs
- **The Groq key is inside the app.** Anyone determined can pull it out of the app file and use up your free Groq allowance, and Groq could block the key. Use a separate Groq key just for EduVerse, keep an eye on usage at console.groq.com, and if it's abused: make a new key, set it as `EDV_GROQ_KEY`, rebuild and ship an update. Groq's free limits are shared by **all** your users (roughly 1,000 big-model requests a day and about 12,000 tokens a minute; the small model has more). When it's busy, learners see "EduVerse is very busy right now. Try again in a minute." Upgrade to Groq's paid plan when you outgrow it; nothing else changes.
- **Check Groq's terms for a children's app.** Groq's developer agreement is separate from its website terms. Read it (or ask Groq) to confirm you may use it in an app for under-18s before you launch.
- **Lesson quality:** Groq's GPT-OSS 120B is good but not Claude-level; Apple Intelligence is smaller still. Expect simpler lessons and the occasional wrong fact.
- **Hindi:** Apple Intelligence doesn't support Hindi yet, so Hindi always uses Groq.

## What you need

- A **Mac with Xcode 26** or newer (Apple Intelligence needs it; on older Xcode that one part is skipped).
- The **Apple Developer Program** (US$99/year). Required for TestFlight, the App Store, iCloud and Game Center.
- A free **Groq** account (console.groq.com, no card) and a free **GitHub** account (no card).

## Step 1. Groq key

1. console.groq.com → API Keys → Create API Key. Name it "EduVerse app".
2. Keep it out of `app/config.json` (this repository is public; leave `"groqKey"` empty). Set it in the terminal before every build: `export EDV_GROQ_KEY=gsk_...`. The build bakes it into the app.

## Step 2. Legal pages on GitHub Pages (works from an iPhone)

1. In `legal-site/`, replace the name and date in `privacy.html` and `terms.html` (already filled in).
2. github.com → New repository → name `eduverse-legal` → **Public** → Create.
3. "uploading an existing file" → choose the 4 files from `legal-site/` → Commit.
4. Repository → Settings → Pages → Source: "Deploy from a branch", Branch: `main`, folder `/ (root)` → Save.
5. After a minute your pages are at `https://YOUR-GITHUB-NAME.github.io/eduverse-legal/privacy.html`.
6. Put `https://YOUR-GITHUB-NAME.github.io/eduverse-legal` in `app/config.json` as `"legalUrl"`.

Have a qualified person read the privacy policy before launch (see "Kids and privacy").

## Step 3. Apple setup (App Store Connect + developer account)

1. Enrol in the Apple Developer Program. In App Store Connect → Business, accept the **Paid Applications Agreement** and add tax and bank details (needed for subscriptions).
2. Create the app (My Apps → +) with your bundle id, for example `com.vipul.eduverse`. Put the same id in `app/config.json` (`bundleId`); the build copies it everywhere else.
3. **Subscriptions:** Monetization → Subscriptions → group "EduVerse Pro" with two products, e.g. `com.vipul.eduverse.pro.monthly` and `.yearly`. Put the ids in `config.json` (`productIds`).
4. **Game Center:** the app → Services (or Features) → Game Center → enable it, then add a **Leaderboard**: type *Recurring*, reference name "Weekly XP", ID `eduverse.weekly_xp` (same as `leaderboardId` in `config.json`), score format *Integer*, sort *High to low*, submission *Best score*, reset every **1 week** (start on a Monday). Add a display name in each language you support.
5. **iCloud container:** developer.apple.com → Certificates, IDs & Profiles → Identifiers → **iCloud Containers** → + → `iCloud.com.vipul.eduverse` (that's `iCloud.` + your bundle id). Xcode can also create it in step 4.

## Step 4. Build the app on the Mac

```
cd app
# edit config.json first: bundleId, legalUrl, productIds
export EDV_GROQ_KEY=gsk_...   # your Groq key (step 1); needed in every terminal you build from
npm install
npm run ios:add      # builds www/, creates the Xcode project, applies settings + entitlements
npm run open         # opens Xcode
```
After any change to the web app or config: `npm run sync`.

**Xcode steps (once):**
1. App target → **Signing & Capabilities** → pick your Team (automatic signing).
2. Check these capabilities are listed. If one is missing, add it with **+ Capability**:
   - **In-App Purchase**
   - **iCloud** → tick **CloudKit** → tick the container `iCloud.<your bundle id>` (press + to create it if it isn't there)
   - **Game Center**
   The project already points at `App/App.entitlements` with these, so usually they appear by themselves.
3. Check `App/PrivacyInfo.xcprivacy` is in the file list with Target Membership ticked.
4. Run on a real iPhone (not the simulator, for Game Center and iCloud). Sign in to iCloud and Game Center on that iPhone first.
5. For quick purchase tests: Product → Scheme → Edit Scheme → Run → Options → StoreKit Configuration → new `.storekit` file with your product ids.

## Step 5. Before the first App Store release: CloudKit schema

The first time the app syncs (in development), CloudKit creates a record type called **Progress**. Before release: icloud.developer.apple.com → CloudKit Console → your container → **Schema** → **Deploy Schema Changes** to **Production**. If you skip this, syncing fails for App Store users.

## Step 6. TestFlight and App Store listing

1. Product → Archive → Distribute → App Store Connect → upload. In App Store Connect → TestFlight, add yourself as a tester and install via the TestFlight app.
2. Test: make a course on a phone without Apple Intelligence (Groq) and on one with it, homework photo, the free limit, Game Center friends, sign in to the same Apple ID on a second device and check the courses arrive, buy and restore Pro with a Sandbox tester, delete all my data.
3. **Listing:** Category Education. Price Free with in-app purchases. Privacy Policy URL and Support URL: your GitHub Pages addresses.
4. **App Privacy (nutrition label):** must match `app/ios-overlay/PrivacyInfo.xcprivacy`: *Other User Content* (text sent to the AI to answer; not linked to identity; no tracking). Purchases are handled by Apple. Tracking: **No**. You are the one attesting to this, so check it.
5. **Age rating:** answer Apple's questionnaire honestly (generative AI, Game Center friends). Don't choose the Kids Category for v1.
6. **Review notes** (App Review Information):
   > No sign-in is needed. EduVerse is a learning app. AI answers are written by Apple Intelligence on supported iPhones, otherwise by Groq's hosted open models; a child-safety instruction is added to every request, and self-harm or abuse messages are never sent to the AI. Homework photos are read on the device (Vision) and only text is sent. Progress syncs through the user's own iCloud. Friends use Game Center. A parental gate (a multiplication question) protects purchases, links and data deletion. Under-13s (from the age question in the welcome tour) can't use friends, challenges or share cards. To test the paywall: Settings → Grown-ups → Plans.
7. **Export compliance:** standard HTTPS only; `ITSAppUsesNonExemptEncryption` is set to NO.

## Features

- **Welcome tour:** language first, then a neutral "When were you born?" (month and year), then a short tour. Learners under 10 start on the Kid level. Replay from Settings. Age can be changed in Settings; going from under 13 to 13+ asks the grown-up question.
- **Whole interface in 8 languages** (English, Hindi, Spanish, French, German, Portuguese, Chinese, Japanese), including the AI content. Translations live in the page (`window.__EDV_I18N`); new English text you add later shows in English until added there.
- **Friends (13+, Game Center):** sign in to Game Center, see Game Center friends and this week's XP leaderboard, "Add friends" opens Apple's friend request screen. If Screen Time restricts Game Center, the app says so.
- **Challenge a friend (13+):** a code with the exact game inside; the friend pastes it under Games → Got a challenge code? and plays the same questions with no AI use.
- **Share cards (13+)** and the **grown-up view** (Settings → For grown-ups) with share cards that use the child's first name.
- **Voice control:** answer, next, hint, "I'm confused" by voice (Apple speech recognition).
- **Settings → Grown-ups:** plan and today's AI use, Apple Intelligence on/off, restore purchases, legal pages, delete all my data (this device and iCloud).

## What I tested, and what I could not

Tested here (`cd app && npm test`, needs Playwright and Chromium): **25 checks, all passing**, with a stand-in for Groq's API and simulated Apple plugins: Home opens with no sign-in; courses and lessons from Groq with JSON mode, the right model and the child-safety rules; streamed homework answers; homework photo turned into text before sending; self-harm message answered kindly without calling the AI; fallback to the small model when the big one is busy; same course again comes from the phone's cache; daily limit shows the paywall; progress saved to iCloud and appearing on a second "iPhone"; Apple Intelligence used first when available; Game Center sign-in, friends, weekly XP and Add friends; under-13s blocked from friends; Pro from StoreKit; legal links open the hosted pages after the grown-up question; delete all my data also clears iCloud; no JS errors; no network requests except the AI.

**Not tested, because it needs a Mac, Xcode and Apple's servers:** compiling the project and the Swift plugins (`app/plugins/eduverse-store/ios/Sources/`: StoreKit, iCloud, Game Center, photo text, speech, Apple Intelligence), real Groq answers, real purchases, real iCloud and Game Center. I wrote them carefully against Apple's documented APIs, but expect to fix small things on the first Xcode build. Plan time for TestFlight.

## Kids and privacy: please don't skip this

I'm not a lawyer. Learners as young as 5 bring in children's privacy laws (COPPA in the US, GDPR and the UK Children's Code in Europe, India's DPDP Act, and others). What the app does to stay on the safe side: no accounts or server of yours, no ads, analytics or tracking, no third-party SDKs, progress only in the learner's own iCloud, photos read on the device, friends only through Apple's Game Center (with Screen Time controls) and only for 13+, in-app deletion, a parental gate. Things that may still apply to you: Groq processing the text learners type (check Groq's data and age terms, and whether you need a data-processing agreement), and an honest privacy policy reviewed by a qualified person.

AI safety: a child-safety system instruction is added to every request (Apple Intelligence and Groq), and messages that mention self-harm or abuse are never sent to the AI; the learner gets a kind message pointing to a trusted adult and helplines. This is a basic layer, not a full moderation system.

## Files worth knowing

- `app/config.json`: bundle id, Groq models (the key comes from `EDV_GROQ_KEY`), legal pages address, Game Center leaderboard id, daily limits, product ids.
- `app/www-src/eduverse.html`: the EduVerse web app (same as the Claude version).
- `app/www-src/native-shim.js`: AI routing (cache → Apple Intelligence → Groq), photo text, iCloud and Game Center bridges, paywall, parental gate, Grown-ups settings.
- `app/plugins/eduverse-store/ios/Sources/EduverseStorePlugin/`: the Swift plugins.
- `app/scripts/build-www.js`: builds the app's web files from the web app (bundles fonts and maths, removes outside requests, fills in config).
- `app/scripts/apply-ios.js`: Info.plist texts, iPhone-only portrait, entitlements (iCloud + Game Center), privacy manifest, icon.
- `legal-site/`: the pages for GitHub Pages.
