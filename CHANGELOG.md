# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **The corvid lives in its ring.** The mark is two things now: the ring, the C, which never moves, and the bird in it, which is the only thing any animation touches. The sidebar's bird blinks every three to seven seconds, one blink in five doubled, and between them it looks about, cocks its head, looks back over its shoulder, preens, shakes out its feathers, stretches a wing, caws without a sound and hops. Every act is made fresh from a random source, so no two are alike, and every one ends in the logo. Big acts wait while you type. It watches the pointer when it comes near, in the quick turns and still holds a bird's head moves in, gets ready when its button is hovered or focused, and falls asleep after two and a half quiet minutes, waking with a start. It costs nothing while it is still: one timer between acts, frames only while something moves, nothing in a hidden tab or out of view.
- **It leaves the ring to fly, a different way every time.** A press sends a full corvid out of the C. It crouches, turns its body under a head that holds still, draws in the back of its head, which the ring had been drawing for it, and leaps. Each lap is a new random route, with its own pace, bursts of wingbeats and glides, pitch with the climb, a turn round where the route doubles back and, now and then, a barrel roll. It comes home from the ring's open side, flares, lands, folds its wing and looks back over its shoulder into the logo. The ring stays in the sidebar the whole time, empty. `planFlight` in `src/lib/corvidFlight.ts` is pure and seeded, so every promise is a unit test.
- **The rig.** `src/assets/corvidRig.ts` poses the logo's own strokes from a set of numbers, so the flying, preening and sleeping bird is the same drawing as the mark and not a second one. At rest it draws the logo point for point. The model sheet, `docs/brand/corvid-poses.svg` and `.png`, is every pose drawn by the rig, written by `npm run brand:icons` and held byte for byte by a test.
- **It answers the app.** A follow-up done gets a nod, a conversation written down a silent caw, somebody new a hop, a person tracked a cock of the head, a merge a preen, a restore from the trash a nod, and an import that adds people the celebration pass. Each is asked for on success only, and a repeat within four seconds plays once. A celebration waits until no dialog covers the page.
- **It notices the app at work.** `apiFetch` counts every request that comes back OK. About once a hundred requests, or once every six to twelve AI answers, the bird does something of its own, and now and then, at Full, takes a short flight near home. Never twice in twenty seconds, an outing never twice in three minutes, and never an outing while a dialog is open or a field has focus.
- **The bird beside "Corvid motion".** Settings, Appearance: a live bird in its ring next to Full, Subtle and Off, living faster so the row shows what it does. It is a button named "Try the corvid": a press flies it from its own ring at Full and flutters it at Subtle. The empty detail pane's large bird lives calmly now, and the "All reviewed" bird hops and then lives calmly.
- **A favicon drawn for each size, and a brand kit.** The mark has four optical sizes now (`CORVID_OPTICAL` in `src/assets/corvidPaths.ts`): the same paths with a stroke, an eye and a margin for the size a person sees. At 16 px on a 1x screen the tab takes `tiny`, the C, the head, the wing and the outer tail. At 2x and 3x it takes `small`, the whole bird. Launcher, home screen and store icons take `medium`, and the logo is `large`, its own weight. The size a person sees picks the master, not the file's pixels. `public/` serves `favicon-16.png`, `favicon-32.png` and `favicon-48.png`, the two smallest fitted to the pixel grid, `favicon.ico` with the three frames, the touch icon, the launcher icons and maskable icons at 192 and 512. `docs/brand/` is the kit: the mark in four versions (light ground, dark ground, one colour, reversed), the app icon's master and a 1024 px render, the lockup of the mark and the name for light and dark grounds, the repository's social card, and `docs/brand/README.md`, the guide: the anatomy, the sizes, the colours with their contrast, clear space, minimum size, type, every file and what it is for. `npm run brand:icons` writes all of it, and a test holds every SVG byte for byte.

### Changed

- **Nothing moves the ring.** The thinking bird tilts only its head, about the rig's neck, and each one keeps its own time, so two thinking at once are not in step. The head shake at a wrong password turns the bird's head away and back, and the "All reviewed" hop lifts only the bird. At Subtle a press on the perch flutters the bird's wings instead of hopping the whole mark. The mark's parts are named for what they are: `body` is `ring` and `beak` is `head`.
- **The tab's corvid reads as a corvid.** The favicon was the ring, the head and the wing at one heavy stroke, scaled to every size: at 32 px they ran together into a wave, and a home screen showed the same slab at 512. Each favicon is drawn for its pixels now, and there is no SVG favicon, because a browser takes it over every sized one. The tile runs from primary-dim to 55 percent of the branding gradient, `#2795c9`, so the white bird keeps 3.37:1 in its lightest corner, where it had 2.1:1 on `#47befd` and the tail faded into it.
- **The link preview wears the brand.** It shows the app icon with the whole bird, on the app's own surface, `#f8f6f2`, where it had a cool grey that was never the app's. The name is set in Manrope ExtraBold and the line under it in Inter, the app's faces, as outlines. The README opens with the lockup, with a dark version for a dark page.
- **The left panes show their scroll bar on hover.** The Network list and the Settings rail show their thumb only while the pointer is over them or the keyboard is in them. The bar sat against the sidebar all the time and read as part of it. The lane stays, so nothing moves when the thumb comes back.
- **Track's glyph and word sit in the middle of the button.** The label keeps the width of its longest word, and a short word such as Track sat against the left edge with a gap before the chevron.
- **The shortcuts dialog shows the page's own keys.** `?` and the sidebar's keyboard button open two columns: the shortcuts that work everywhere on the left (Navigation and Global), and the page's own on the right, from `pageShortcutGroups(pathname)`. A contact shows its keys and the list's beside it, the map its five, Pulse its queue keys, the Possible duplicates queue its own, and a page with none says "No shortcuts of its own". It listed every group in the app in one column, so the map's keys sat below forty that did nothing there. With single-key shortcuts off, the keys the switch turns off are dimmed and named "off", and the footer links to the switch. Otherwise it links to **All shortcuts** on Settings, Keyboard. The Possible duplicates queue's J, K, L, H and Space are in the table now, and its letters obey the single-key switch. Notes' one row is folded into Ask Contrack, with Escape to clear the search. The dialog and the Keyboard page share one set of keycaps (`ShortcutKeys`).
- **Track is slimmer.** The button is about 110 px wide at its widest word (it was 121): 4 px between its parts, tighter sides and a 12 px chevron. Its menu is 11 rem wide, where every other menu starts at 13 (`ActionMenu` gains `panelClassName`).
- **Settings has the Network list's left pane.** The rail opens at 350 px and a person drags its edge between 300 and 480, with the keys, the double click and the press of the list's handle. One stored width serves both panes (`LEFT_PANE` in `src/components/layout/paneWidth.ts`), so moving between Network and Settings leaves the page where it was. The rail's scroll bar sits on its left edge, as the list's does. The loading skeleton opens at the stored width. It was a fixed 240 px.
- **Reset to defaults is one button, at the page's end.** While any setting on a page is off its default, the page ends with **Reset to defaults**, in the look of Pulse's Log note. It resets every changed setting on the page, says how many in a toast with Undo, and puts the keyboard on the first row it reset. Each row had a Reset button of its own. The dot after a changed setting's title stays, and "changed" now means the value: a setting set back by hand is stored at its default and takes its dot away, and the button goes with the last one. `PreferencesContext` gains `changed` and `setPreferences`, and `resetPreference` keeps one identity across its states.
- **Tracked contacts is a settings page.** It opens at `/settings/tracked`, inside the shell: the rail stays beside it, the header is the shell's, and Select sits in its actions. Pressing it in the rail used to leave Settings for `/tracked`, and the rail vanished. The old path leads to the new one with its hash, and the Network list's Manage link and the Keeping up card link to it. The `door` flag on a settings page is gone.
- **The Duplicates page puts the tool first.** The tabs, **Scan** and **Manual merge**, come first, then the scan's one card: the three scans as a radio group, each with one line, and **Scan now**. **Automatic merging**, the sensitivity and the two automatic checks, is a section under the tool. The settings used to sit in a card above the tool, and the tool opened on a large brain icon that repeated the page's title. **Merge activity** is the square history button in the header at every width, as Ask Contrack's History is. The page is a block in the shell's one scroller now, and its Reset to defaults comes with it.
- **A tag on the Tags page opens the people who have it.** Its name and count are a link to `/?tag=<tag>`: the Network list shows the tag as a pressed chip, "# investor 7", and keeps the contacts with that whole tag, in any case, spaces included. Pressing the chip, All or any other chip shows everyone again.
- **The admin General page, tightened.** Four sections: Instance, Sign-in, Data and Integrations, each a card of `SettingRow`s, so every setting is a search result (the rows gain Sign in by emailed link, Snapshots to keep, SearXNG and the Google OAuth client). The cards repeated their heading as a first sentence and ended with a paragraph of their own. The instance name's count shows near its limit only.
- **One radio group for Settings.** Settings drew ten radio groups by hand, each with its own tile and its own keys. `ChoiceGroup` draws eight of them: the General page's four sets of presets, the dedupe scan, a password reset's delivery, and the role of a new account or an invitation, which share one `RolePicker`. An invitation's role now says what each role may do, as a new account's did. A token's expiry and an invitation's are short choices with no hint, so they are a `Segmented`, as a connector's schedule is.
- **A statement ends without a period, on every page.** Every settings page's description, every row's, and the one-line statements on cards, buttons, hints, empty states, dialogs, banners, errors and toasts drop their closing period, and a statement of several sentences drops only its last. Words a person only hears keep theirs, because a speech engine ends a sentence on it: an accessible name, the search's live region and the drag announcements. Two strings copy another system's words exactly and keep them too: the server's sign-in error and the browser's abort message. `tests/unit/copy.periods.test.ts` holds the rule for the statement props, the text between tags and every sentence written as a string under `src/`, and for the settings registry and the destination names. The last five errors that said "Please" do not.
- **Simple empty places say it in the title.** `EmptyState`'s sentence is optional. "No lists yet", "No tags yet", "Trash is empty" and the audit log take none. Recent imports is not drawn before the first import. Import, Archived, Accounts and Privacy say less.

### Fixed

- **The link preview's name was in Helvetica.** The script set it through Pango, and on macOS Pango finds fonts through the system, not through the file it is given. Manrope is not a system font. Every word in a brand image is an outline of the app's own WOFF2 faces now (`scripts/brand/type.ts`, with `fontkit` and `wawoff2`), and measures within a twentieth of a pixel of Chromium's.
- **Notes search flickered.** Five causes, each measured frame by frame. The old cards remounted and faded in again the moment the words changed. A slow answer's results gave way to a shimmer after 150 ms and came back. The shimmer then held an answer that had already arrived for up to 400 ms. The empty state blinked out on every filter change. And the box's glyph spun for one frame on every fast search. The last answer now stays in place until the next arrives, and the next replaces it in one commit, keeping any card that is in both. A search slower than 150 ms dims the old answer and spins the glyph until the new one lands. Only a first search shows the shimmer, and it holds 400 ms once shown.
- **A new note search asked twice.** The page offset was reset in an effect after the render, so a new question on page two first asked for page two. The offset is keyed by the search now, and a new question asks once, from the first page.
- **"No notes match" asked for a stem.** The index already stems and matches every word as a prefix. The hint says "Try fewer or other words", or a wider period.
- **People search dropped an Engineering role for "engineers".** The hard filter matched a role as a whole word, so "engineer" found nobody whose role is Engineering and "designers at Aperture" missed the Design lead there. A role finds its other forms now (`roleVariants`): engineer and engineering, designer and design, marketer and marketing, consultant and consulting, and the plurals. The first words of a phrase stay, and a field never takes its bare stem. The filter and the check after the rerank read the same forms.
- **A link to a Tracked group landed at the top.** The virtualiser attached to the page's scroller even when the list was short, and put the scroll back where it had last seen it, after the page had scrolled to `#fading`. It is enabled only past 200 rows now.
- **The note search compiled its statements on every request and read whole note bodies.** Its statements are cached by their SQL, and a hit whose title matched reads only the 241 characters of its body it shows.
- **Two duplicate warnings said a merge cannot be undone.** A large cluster's warning called merging irreversible, and every merge is logged and can be undone from Merge activity. Both say "Check that they are all the same person" now.
- **History rows remounted as a question was recorded.** A row was keyed by its id, which is a stand-in until the server answers. It is keyed by the question now.

- **Track is one menu, with one word for how often.** The split button, a toggle word and a caret behind a hairline, is one menu button now: 32 px tall, flat, with no line down its middle. Untracked it reads **Track**. Tracked it reads the cadence in the selected tint, one word: **Weekly**, **Monthly**, **Quarterly** or **Yearly** (7, 30, 90 and 365 days). The menu, **Keep up**, lists the four. Untracked each row tracks in one press and the account's default carries the hint "Default", which a screen reader hears too. Tracked the current row is checked and **Stop tracking** sits under a hairline. Quarterly stays because 90 days is the account default and most tracked contacts have it. A cadence of 60 or 180 days, a choice before 2.0, keeps working: the preference still accepts both, a menu shows it as one more checked row ("Every 2 months"), and the button says it short, "2 months". Every word the button can show sizes its label, so it keeps one width. Toasts read "Tracking Ada Lovelace, quarterly". The `t` key stays a one-key toggle at the default cadence. `CadenceMenu` is folded into `TrackButton`, and `shared/cadence.ts` gains `shortCadence` and `cadenceOptions`. `ActionMenu` items gain `separatorBefore` and `speakHint`.
- **Change avatar is a pencil on the picture.** The item left the ⋮ menu for a small round badge on the ring's lower right, "Change avatar": 28 px on the 96 px avatar and 24 px on the phone's 56 px one, with a 44 px tap box set out towards the empty corner, so a tap on the face still opens the score breakdown. It is lightly clear at rest and solid under the pointer or the keyboard, and it shows on a phone, which has no hover. It is its own button beside the score button, never inside it, and focus comes back to it when the picker closes. The Archived chip moved just under the avatar, clear of it.
- **Enrich contact, from the ⋮ menu.** It researches this one person in the background, the way the Enrichment page does for many: the progress panel opens at the bottom right and the page stays yours. It is hidden with AI off and for a ghost, and reads **Enriching…** while this contact's research runs. A cooldown or another account's research is said in a toast (`startSearch(ids, { limitAs: "toast" })`). It had no page to say it on, and a refused start said nothing.
- **+ link on the meta line.** After the links, with no dot before it, as "+ tag" follows the tags. It opens a field, "Paste a link". Enter adds it with `https://` when the text has none. Text that is not a web address, or a link the contact already has in any spelling, is refused beside the field, and the text stays. The server works out the platform from the host, so the link arrives with its icon. On a phone it is the plus alone.
- **The local time says its zone.** "2:13 PM EDT", "4:45 AM AEST", "GMT+9" where no locale has an abbreviation. A screen reader hears the full name, "Eastern Daylight Time". The digits are tabular, so a phone's meta line no longer rewraps as the minutes change.
- **Pulse's line uses centred dots.** "3 overdue · 1 birthday this week · 12 days in a row", with no commas and no closing period, and one item alone has no dot. A screen reader hears a comma at each dot (`MetaDot`, shared with the contact's meta line).
- **Moving a Pulse card lands where you point.** Customize mode moved nothing until the drop, measured from the dragged card's box, so an 800 px card aimed with the pointer at its top landed by its middle, and the card lagged the pointer behind a `transition-all`. Now the pointer picks the column and then the place, before the first card whose middle is below it, and each step moves the card in a draft of the layout: the target column opens a 64 px dashed slot and the cards it passes slide aside (`lib/dropTarget.ts`, `lib/flip.ts`). A compact preview follows the pointer with the title and the landing place ("Intelligence · 3 of 5"), and flies into the slot on drop. One write, on drop. Escape restores the layout. A finger holds the grip for 200 ms, and a flick on it still scrolls the page. The grip shows on phones now, and the Move menu gains Move up and Move down at every width in place of the phone's arrows. The arrow keys move a focused grip, and every step is announced with the card, its column and its place. The heavy cards never render during a drag (a render-count test holds it), and the slowest frame during a drag was under 20 ms, where the old drag had a 67 ms one.
- **The right-hand panel opens from one button that stays put.** The 64 px rail at the right edge is gone. Ask Contrack's history and the map's insights open from a button in the page's top-right corner: a square History button level with Ask's title, and a square button with the insights glyph level with the map's toolbar. Both are the pressable `.btn-secondary` with the glyph alone, and while the panel is open the button stays pressed in, in the selected tint (`.btn-latch`), so the one control that opened the panel reads as the one that closes it. The panel's Hide button is gone. The panel slides in from the window's edge under the button, at the slow duration and out at the base one, and its content follows a beat behind. The button never moves. The heading row ends with the button's own face drawn invisible, so the title and the actions stop where the button begins at any word length. Under it the content takes the panel's full width and the scroll bar sits on the window's edge (`SIDE_PANEL_SCROLLER`). The map's panel holds its Summary and People switch in that row, whose words and content say what the panel is, and keeps its heading for a screen reader (`titleHidden`, `lead`). The map runs to the window's edge now, and it eases its padding on the panel's own timing and curve (`SIDE_PANEL_OPEN_MS`), so the pins and the panel arrive together. Escape inside the panel and the page's key (`H`, `I`) still close it and hand the keyboard to the button.
- **Notes search has People's shape.** One search box serves both modes (`AskSearchBox`): the mode's glyph, the words, Clear, and a square search button with the magnifying glass alone, named "Search". The button's word is gone on People too. Notes searched as the words were typed and had no button. Now Enter or the button searches, as on People, and the filters apply the moment they change. The kind is the first chip under the box, **All kinds** or the chosen kind with its glyph ("Calls") in the selected tint, and the label "Kind" at the far end of the period row is gone: what, then when, the order Gmail and Drive use. On a phone the six periods fold into one **Any time** chip, so the two filters share a row. An answer that takes more than a moment shows People's "Searching…" line and shimmer cards, a fast one never flashes them, and once shown they stay long enough to read (`useLoadingShown`). The results header reads "Search results" with the count in People's pill. The suggested questions are gone from Notes. With a kind chosen and nothing found, **Search all kinds** widens the search in one press.
- **The Network list counts a search, and its rows rise toward the pointer.** A search's count sits where its results start, in the list's own small label, the slot "Recent" and "All contacts" hold while nobody searches: "12 matches". A screen reader hears "12 contacts found" once the typing pauses for a second. The row under a mouse rises up to 2 px with a soft shadow, and the neighbour on the pointer's side rises as the pointer nears it: the row below in the lower half, the row above in the upper half, half each on the line between them. The curve is a raised cosine over one row's pitch, so the two lifts always add up to one and nothing jumps. One animation frame per move writes `--p` on at most two rows and React never renders (`useProximityLift`, `.proximity-row`). It follows a mouse only, the rows do not move under reduced motion, a key press lays them down, and in the dark palette a lifted row also takes a faint light wash, because a shadow does not read on the darkest surface. It is the one list that lifts ("Elevation" in STYLE.md).
- **The sidebar's foot is part of the rail.** Keyboard shortcuts, Settings and the account sat in a box of their own, a shade darker with rounded top corners. They sit on the rail's own surface now, set apart by their place at the foot and their tighter spacing.
- **A history entry's Pin and Delete keep off the question.** They floated on a card-face pill over the row's middle and covered the end of the question. They now sit at the end of the entry's meta line ("7 people · 18 hours ago"), which keeps their room, as two small icon buttons with 44 px tap boxes.
- **`.btn-icon` is square at every size.** It was a padding for the small size, so an icon-only button at the regular size came out 34 px wide and 40 px tall. It is as wide as the button is tall now: 44 px on a phone, 40 from `sm`, 32 with `.btn-sm`.
- **The map's heat, rebuilt.** The heat read the clustered source, so a cluster of twelve people added what one person adds, and the densest city drew no hotter than a lone contact. It now reads its own unclustered copy of the contacts. Every person weighs 1, and a long note history weighs up to 2. The densest place (the heaviest 1 degree cell, counted as 4 to 128 people) sets full density, and each stop of the ramp doubles the density, so a town of three and a city of ninety read apart. The radius grows with the zoom (16, 26 and 44 px at zoom 0, 4 and 9), the heat sits under the basemap's labels so a city's name reads over its own heat, and it fades out from zoom 7 while the pins come back at 8. Past zoom 9 the legend becomes "Zoom out for heat". The colours follow MapLibre's heatmap example and the cartography on sequential ramps (CARTO's BluYl, viridis): a transparent start, then the accent's deep tone mixed with a warm yellow in OKLCH, darkest for the most over a light map and brightest over a dark one. The ramp follows a picked accent. `src/views/map/heat.ts` holds it, with tests in `tests/unit/map.heat.test.ts`.
- **The map's bottom line says who is in view, and what to do.** "30 in view", or "12 of 30 in view" when some people are off screen. "3 overdue" is a filter to press (`aria-pressed`): it shows only the people whose follow-up is late, and Clear filters clears it too. "Fit all" shows only when nobody is in view, and with the heat on the line carries its legend, from fewer to more. It held five chips: at risk and the average score went with the Health layer, and the time zones are in the insights panel by name. The count is of the people a person can see: the part of the map under the open insights panel or an open contact is not "in view". When a network is wider than the map shows at its lowest zoom, as on a phone, Fit all shows the stretch of longitude that holds the most people instead of the middle of the box, which was Europe with four of thirty. The line never covers the tab bar, the credit, the zoom buttons or the panel, at four widths, in both palettes, at world and city zoom.
- **One right-hand panel.** `SidePanel` (`src/components/layout/SidePanel.tsx`) is the left nav's mirror at the right edge: a 64 px rail that holds the panel's icon, and a 320 px panel that slides out from under the rail over the page. The page never moves when the panel opens or closes. The rail's icon is a disclosure with a tooltip, the panel's heading row names it, shows a count and ends with Hide, and however the panel closes (Hide, Escape inside it, the page's own shortcut) a keyboard inside it lands on the rail's icon. A closed panel is `inert`. The map's insights and Ask Contrack's history use it. The map's floating Insights button is gone, the canvas ends at the rail, and the insights drop their overview cards, which repeated the bottom line. `RailTooltip` is the label beside an icon on a slim rail, for the left nav and the right rail both.
- **Ask Contrack's history is a rail, and the search box stays put.** From `lg` the History icon sits in the right-hand rail, where the clock button in the header used to be, and the history opens over the page. It used to push the column aside and move the search box 160 px. From `lg` the column sits where the open panel never covers it (`ASK_COLUMN`): centred while that leaves the panel's 320 px free, and only as far left as it must on a narrower window, so at 1024 px the search box ends 35 px short of the open panel. The box sits at the same place with the panel open or closed, at every width. The scroller keeps its bar's lane, so the column no longer shifts when the results arrive. In the filter, the first Escape clears the words and the next hides the panel. Below `lg` the header's History button opens the sheet, as before. The route's loading skeleton draws the rail, so the column lands once.
- **The Network list is as wide as you make it.** From `lg` the list's right edge is a handle: drag it between 300 and 480 px, or focus it and use the arrow keys (16 px, 64 with Shift), Home and End. A double click restores 350, and a press that does not move swaps 350 for the widest the window allows, and back: the way to resize with one pointer and no drag (WCAG 2.5.7). The swap waits a moment for a second press, so a double click still restores the default. It is a focusable separator with its value and bounds, the width is kept per device, and the open contact always keeps 560 px, so on a 1024 px window the list stops at 400. A drag writes one CSS custom property per frame and renders nothing, and the contact page renders again only when its pane crosses 768 px (`useElementWidthAtLeast`), not on every frame. The letters of the jump rail sit 2 px further from the pane's edge, and their tap boxes stay where they were.
- **Pulse asks nothing of you.** The "Ask about your network" field under the masthead and the "Ask about this insight" chip on the daily insight are gone: Ask Contrack is one key or click away, and the two entries repeated it. The masthead is 64 px tall from `sm` (it was 120), so the cards start 56 px higher, and the loading skeleton matches the page at every width measured. The cards line up with the title's left edge (they sat 4 px inside it), and sit 24 px apart everywhere (the rows at 1024 px had 32 and 24). From 1280 px the middle column is never narrower than 19rem: three twelfths was 257 px at 1280, and Coming up cut names short and the Composition switch spilled out of its card.
- **Settings: one back rule, one header, and a slide on the phone.** From `lg` no settings page has a back link. The rail and the sidebar are on screen, and every settings title starts where Pulse's and Tracked's do, 32 px down (it was 52). Below `lg` a page shows "‹ Settings", back to the list, and the list has none (`settingsBackLink` in `registry.ts`). There, opening a page slides it in from the right while the list drifts left, and Back reverses it, in 240 ms on the app's curve. React Router's `viewTransition` option needs a data router, so `slide.tsx` starts the View Transition itself and waits up to 350 ms for the page to draw. A press on a link starts loading the page's code, the tab bar holds still, and the list comes back at the scroll position you left. Reduced motion and a browser without the API just navigate. Each page's description and buttons sit in the header (`SettingsHeaderActions`), the hand-written intro paragraphs are gone, and every page has one scroller, which keeps its bar's lane, so a title starts at the same place whether or not its page scrolls. The slide stays inside the page's own box and no longer passes over the left nav at 768 px. The review fixed the rest page by page. Correspondents no longer lights Connectors in the rail too, admins no longer see AI usage twice, and the selected row's count pill passes contrast. Rows have no lines between them, and a flashed row no longer draws a ring. Outgoing mail's checkbox is a switch, Trash's purge asks through `ConfirmDialog`, Accounts says "Create account", MCP's code wraps, and removing the Google client asks first. Plain words replace "reauth", "ghost", "magic link" and "purge", Import's description names the real sources, and the weather switch is named for what it controls. Lists and AI providers sit in the same centred box as every other page, with a heading over each card and no icons in the headings. Every empty and error state is `EmptyState`. axe finds no WCAG 2.2 AA violation on the 23 pages, at 1440 px light and 390 px dark.
- **One scrollbar.** Every scroller draws the same thin bar: the hairline token for the thumb and no track, from one rule in the base layer. It was a class, `nice-scrollbar`, on nineteen scrollers, and every other scroller drew the browser's own wide grey bar. The Network list keeps its bar on the left edge, away from the letter rail.
- **What lifts on hover, and why.** A lift says "this whole thing opens something". A self-contained surface that acts as one control lifts: a card by 2 px (`card-interactive`), and a smaller tile by 1 px with a soft shadow (the new `lift` class). A row in a list of rows, a button and anything static never lift. Ask Contrack's suggested questions, the Pulse rows on a card's wash, a note's file attachment and the settings tiles that run one thing now lift. Two scans in `tests/unit/styles.floor.test.ts` fail on a hand-rolled `hover:-translate-y-*` or `hover:shadow-*`, and on a `transition-*` class beside `lift`. The protocol is "Elevation" in `.agent/STYLE.md`.
- **Buttons press, and the whole app shares one look.** A call to action now has depth: its face sits on a darker edge, rises 1 px on hover and sinks onto the edge on a press, and the edge's bottom never moves, so the button reads as one object going up and down and nothing around it shifts. The edge is mixed from the face, so it follows a picked accent, a contact's colour and the dark palette. `.btn-danger` joins `.btn-primary` and `.btn-secondary` for an irreversible destructive act, and `.btn-sm` is the small size with the 44 px tap box built in. A disabled button is flat, with no edge, so a disabled primary no longer looks like a secondary. Three destructive buttons in the admin pages named a colour token that does not exist and drew no red at all. **One hover per kind of surface**: a flat control (a row, a ghost button, a pill, a nav item) takes a 6 percent ink layer that works on any surface in both palettes, a card that is itself a control rises 2 px, and a static card has no hover. This replaces about eighty hover classes, including a result card that scaled its text and animated a CSS property that does not exist. **One selected look**: a selected row, pill or nav item wears the primary tint and nothing else, never a ring, which read as keyboard focus, and never a bar down the leading edge, the stock accent of generated interfaces. **One focus ring**: the base layer's 2 px outline, outside a control and inset on a text field, replaces ten `focus:ring-*` variants, and a composite field such as the Ask search box draws the ring on its box. **One page header**: Network, Pulse, Ask Contrack, Tracked contacts, Possible duplicates and every Settings page share `PageHeader`: the page's name is the title, 24 px on a phone and 30 px from `md` on every page, the narrow Network pane too, with the same top spacing and no band, border or icon tile. Pulse's title line reads "Pulse Tuesday, September 22", the day in a softer ink at the title's size, and on a phone the day takes its own line under the title and the buttons. **Colour that means something**: overdue is red, today and catch-up are the primary, birthdays and possible duplicates are amber and new people are green, from one tone map that the Up next dots, row glyphs and chips and the Inbox icon tiles all read. A search match is a warm highlighter mark instead of a second blue. The AI reason on an Ask result wears the AI colour, and a field a model filled wears it too instead of a pulsing primary glow. The contact colours lose Violet and Indigo and the accent presets lose Violet, because they sat on the AI colour's hue and made a contact's own buttons look like a model's chips. **Warm paper**: the light greys lean warm at the same lightness, so every text colour clears AA by the same margin. **One tracking and sentence case**: every uppercase label tracks at 0.08em and every string a person reads is sentence case. **One curve and three durations** (120, 160 and 240 ms) for every transition, in `src/index.css` and `src/lib/motion.ts`. The corvid tilts its head on Ask Contrack while a search runs. `tests/unit/styles.floor.test.ts` scans the source for every rule above, and `.agent/STYLE.md` describes them.
- **Fixes found along the way.** A contact's page set five of the six accent tokens to the contact's colour, so text on the tint kept the app's accent. It now sets all six. Two borders named `outline`, which is not a colour token, and drew in the text colour. The Connect Google dialog's "Configure in Settings" link went to a route that does not exist and now opens the Integrations section of the General page. The Connectors and Correspondents pages had no side padding. The dark glass panel reset the hover layer on the map's floating buttons. Ghost contacts, the dedupe demo data and the mock seed wrote colour ids the client no longer draws. The Pulse editing bar named animation classes nothing defined, and it now fades in. Radio-style option groups (the admin presets, a role, an invitation or token expiry, a follow-up date) show the chosen option with a filled dot as well as the tint, a picker of icons or avatars marks its choice with a ring in the ink colour, and the icon pickers and the avatar style chooser now tell a screen reader which option is chosen. The unused Instance page and the Duplicates view's standalone header, which nothing rendered, are deleted.
- **Ask Contrack leads with the search box.** The header is the title, the People and Notes switch and the History button, with no line of description. Indexing is one slim line under the box, "12 of 30 contacts indexed" with quiet Index missing, Inspect failed and Retry failed buttons, in place of the empty-state hero, the explanation and the coverage card. The suggested questions are flat chips, and the first three come from the person's own network, its most common industry, city and company, so a press always finds someone. The fixed questions found no one on a real network, and "Who haven't I contacted in over 3 months?" never could, because People search reads profiles, not dates. The history pane has a Hide history button at the right end of its header, and the History button in the page header, one name in both states, opens it again. On a phone the history sheet closes from a visible X. A search with no results is one line, "No one matches", and a notes search with none drops its count, its any-word notice and its order. The results label is the muted label style, not a second blue that read as a link.
- **A second pass over every page, with AI on.** From 768 to 1023 px the Network list ran 64 px past the window and cut off Import, New and the sort menu. It now fills the space beside the rail. In select mode the title stays "Network", the count leads the bulk bar and is spoken whole, every action rests at "0 selected" (Delete was live there), the list keeps room under its last row for the bar, and focus moves between Select and Done. A deep link scrolls the list to the open contact, and a contact the list does not show is marked in Recent. The contact page's "Pending follow-up alert" now says the fact, "Follow-up 3 days overdue", "Follow-up due today" or "Follow-up due Friday", from one helper that the row's name and its tooltip share. The map counts a follow-up as overdue by calendar day, so one due tomorrow no longer counts at 6 PM in Los Angeles, and its credit, legend, toolbar and strip no longer cover each other or the open contact. Pulse cards had about 30 px between the title and the body and now have 16, and they keep their height in customize mode. A one-day-late chip reads "1 day overdue". The first Up next row no longer looks selected before a person does anything: the tint and the name's primary ink follow keyboard focus and the queue keys, a press outside the list clears them, and while no row shows the tint the first of J, K, D, S and L only shows it, so D never completes a row nobody can see. A queue key pressed in a dialog, such as D on a button in the Log note dialog, belongs to the dialog. The resting checks clear 3 to 1. The masthead says "All caught up." only when the whole queue is empty. Daily insight's skeleton takes the insight's own shape, and its category sits under the title in sentence case. On the Duplicates pages, pair rows show whole names on a phone, the keeper's values read "Kept", not "Discarded", the settings page is one scroller with Compare stuck above the tab bar, and the scan card shows its exact-match and AI rows for the modes the picker offers. The command palette's Shift peek was clipped to 56 px by the palette's own panel and now shows in full, and the avatars lose a freshness ring that reused the health colours. The Notes suggestions are searches that find notes ("meeting last month", "calls this year"), and "Any time" no longer shows pressed while a date phrase in the words sets the range. A dialog without a title no longer draws a hidden Close button that covered its header. A history row's Pin and Delete no longer take taps while hidden. No raw palette colour is left in the app, and `styles.floor.test.ts` now fails on one, and on every form of a coloured bar down a leading edge.
- **Every Pulse card that is not the queue answers its question or steps aside.** An empty card is one line on the page surface: Inbox reads "Nothing to clean up.", Coming up reads "Nothing in the next two weeks." with a Connect a calendar link, and Daily insight without a key names the next step by role, "Add an AI key to get one." with a link to the AI settings for an admin and "Your admin has not added an AI key yet." for a member. **New people folds into Inbox.** The card and its Network growth modal are gone, and Inbox opens with the tracking action, "6 new this month, 2 untracked", a row that opens the Network list at `tracked:no`. The untracked count is read off the slim rows on the client. Inbox rows sit on the wash with no border, the count in each sentence in bold, and every row is a link. **Ask on Pulse.** A form under the masthead sentence, "Ask about your network", sends its question to the Ask page. It renders when AI is allowed and there is a network to ask about, from `sm` up only, because the phone has Ask Contrack in the tab bar. The Ask button waits for three characters, the shortest question the search runs. **The insight speaks for itself**: 15 px text, the category as a quiet badge after the title, and one chip, "Ask about this insight", that asks about its first sentence. **Coming up stops repeating the queue.** Birthdays in the next seven days are Up next's, so the card starts at day eight, and its birthdays and meetings sit in one list ordered by date with a chip that says when, "In 10 days", "Thursday". **Keeping up keeps the bar and the number.** The bar is 10 px, the number within cadence is the large figure, "9 of 10 within cadence", and "1 to catch up" is a button that scrolls the queue to its Catch up group. The four-week promise and "tracked in the last 30 days" are gone, and Rising and Cooling appear only once four snapshot weeks exist. **The heatmap fills its card**: the squares scale to the width, with month labels above and M, W, F at the left, and a pointer or a tap on a square shows one tooltip with the day's words, "Wed, Sep 17: 2 notes, 1 call", in the person's own locale. The sparkline is drawn at the width it is shown at, so its stroke is even, with a dot on this week, and its footer reads "53 in the last four weeks · +29% on the four before" and "This week: 1 note, 3 meetings". The streak is the masthead's. **Composition moves last**, to the end of the Intelligence column, as a 96 px donut in one hue, the primary at six steps, with a text legend of links under it. The AI colour leaves the chart. The Activity card reads its data from the page and no longer asks the server a second time.
- **The Network list applies a facet from its query.** `/?q=tracked:no`, `/?q=missing:company`, `/?q=updated:>6m` and `/?q=industry:Technology` used to put the words in the search box and score them as a name, which matched nobody. The list now applies the facet the way the command palette does and ranks the free text that is left, so every link from Pulse lands on the people it names.
- **A stored Pulse layout with an empty order shows the default order.** The server's default preference is `{ hidden: [], order: {} }`, and the cards it did not name came back in the order of the id registry, which put Composition ahead of the insight. They now come back in the default order of their column.
- **Up next is a pane, and its rows read as rows.** From `lg` the queue scrolls inside its card, capped near the viewport, so the page stops growing with the queue and the other two columns end where they end. The group headings, "Overdue", "Today", "This week", "Birthdays", "Catch up", stick to the pane in the card's colour with a small dot in the group's tone and the count at the right. **A click or a tap anywhere on a row opens the contact**, the same as Enter, and the "Open profile" button is gone. A row is two lines with a free right edge: the name and the chip on the first line, which wraps on a phone so the name is never cut, the title on the second, and "Last spoke 12 days ago" under them. **The chips speak in sentence case**: "12 days overdue", "Today", "Tomorrow", "Wednesday", with no border and no caps. The check shows faintly at rest. The selected row wears the Network list's tint, not a focus ring. **Snooze is the shared menu**: from `sm` it floats over the row's right edge on hover or focus, on a phone it sits in the flow as a 44 px target, and it renders only on a follow-up. The Keyboard tip in the card header lists the keys. The empty queue reads "Nothing due today" with one button, Log note, and the confetti takes the palette's own colours. The masthead's counts now land on the group headings inside the queue.
- **Completed is one line.** "Nothing completed yet." or "3 completed recently" with a quiet Show that opens the list under the line: the title struck through, the name as a link and when it was done. Hide closes it.
- **Pulse cards keep one padding.** The card surface carried 24 px of padding and the card frame added 16 to 20 more, so a card on a 390 px phone spent 80 px of its 350 on padding. The frame now sets the one inset, 16 px on a phone and 20 px from `sm`, and every card's body is that much wider. `InfoTip` gains `align="end"` for a trigger at the right edge of a card, so its panel opens over the card instead of past its edge.
- **Pulse has a masthead that leads with the day.** The title line reads "Pulse Tuesday, September 22": the page's name in the title ink and the day in a softer ink at the same size, 30 px (24 px on a phone, where the day takes its own line), so the first thing on the morning page is the morning. One sentence replaces the row of chips: "2 overdue, 2 due today, 3 birthdays this week. 12 days in a row." From `sm` up each count is a button that jumps to its card, and on a phone the counts are plain text that wraps, so nothing scrolls sideways. **Log note is the one primary action.** New contact and Customize layout move into a **More** menu, and the `c` key still toggles customize mode. The masthead stays under 180 px on a phone before the first card.
- **Enter belongs to the control that has focus.** A window-level Enter used to open the highlighted Up next contact from anywhere on the page: on the Customize button, on the Manage link, on a snooze menu item. That handler is gone. Each Up next row is now a focusable list item with a roving tab stop: Tab reaches the highlighted row, **Enter opens its contact, Space completes it (or logs a note for a birthday or a catch-up), ArrowDown and ArrowUp move the highlight**, and the highlighted row scrolls into view when J, K or an arrow moves it. A button inside a row keeps its own keys. The arrows join the shortcuts dialog under Pulse.
- **One type scale and one grid for Pulse.** `PULSE_TYPE` in `src/views/pulse/lib/pulseStyles.ts` holds the page's sizes (card titles 15 px, names 14 px, meta 13 px), and `GRID_CLASSES` and `COLUMN_CLASSES` hold the three columns, which the page, its skeleton and the route fallback all read, so the silhouette no longer jumps between 1280 and 1535 px. The columns are 5, 3 and 4 of twelve at `xl`: Up next is the job, so it takes the widest. At `lg` the Intelligence column runs its cards two across under the other two, and the sortable strategy is the rect one, which sorts a list and a grid alike.
- **A card is a title and a body.** `CardFrame` loses the header hairline and the icon. The count is muted text after the title, and a screen reader hears "Up next, 10". A new `line` variant renders a card with nothing to show as one row on the page surface: the title, the count, one sentence and the customize controls. Later prompts apply it to Completed, Inbox zero, Coming up and Daily insight.
- **Customize mode, quieter.** The Hidden cards tray renders only when a card is hidden. The bottom bar says what to do at that width, "Drag a card to move it. Use the eye to hide one." from `sm` and "Use the arrows to move a card and the eye to hide one." on a phone, and wraps to two lines above the tab bar. The welcome state reads "Bring your people in. Import contacts and log a note. Pulse fills itself from there."
- **Track is one control, a split button, and it keeps one shape.** The cadence used to arrive as a separate chip beside the Track button the moment a contact became tracked, which pushed the word "Track" sideways under the reader's pointer. It is now the caret at the right end of the button itself, behind a hairline in the same rounded shell, and the button takes the primary wash when it is on as before. **The caret is there in both states**, so nothing appears on press and no empty slot waits for it: before tracking it is named "Track, and choose how often" and its five rows track the contact at the cadence you pick rather than at the default, in one press, and after tracking it is named for the cadence in force and its rows change it. **The word does not move either.** The header cluster is right-aligned, so a control that grows drags its own label along: the label is sized to the longer of "Track" and "Tracked" with the current word drawn over it, which makes both states the same width to the pixel. The narrow header keeps the shape with the glyph alone. `shortCadence` in `shared/cadence.ts` goes with the chip that used it.

### Added

- **Keeping up, the one card on Pulse for the people you track.** It takes the Momentum card's place at the top of the Network column and shows the state now and the trend: a bar split by the ring state of every tracked contact, named "42 tracked: 30 strong, 8 fading, 4 at risk, 0 with no interactions yet", with a legend of links to the groups on the Tracked contacts page; one line, "31 of 42 within cadence, 11 to catch up"; Rising and Cooling, three each, with the delta as a chip, or the line "Rising and cooling show after four weeks of tracking" before four snapshot weeks exist; and "5 tracked in the last 30 days". When nobody is tracked, the card says so with one button, Choose people, to the Tracked contacts page. Its **Manage** link is the door from Pulse to that page. The dashboard payload carries it as `tracking`, with `catchUp` beside it.

- **Track, in one place and in bulk.** The controls that set the flag, now that the ring means tracked. On a contact page, **Track** is the one button beside the actions menu: a toggle that reads Tracked when on, with the ring appearing around the avatar as it is pressed and a toast, "Tracking Ada Lovelace, every 3 months", with Undo. Pressed again it stops tracking, and Undo brings the contact back with the cadence it had. Beside it, while tracked, a chip reads the cadence in words and opens a **Keep up** menu of the five choices, with a value set through the API shown as a sixth checked item so the menu never lies. The `t` key does the same, listed under Contact in the shortcuts dialog. The bulk bar on the Network page and on the map gains **Track**, or **Untrack** when every selected contact is tracked, which flips only the contacts that differ and offers Undo. The filter row gains a **Tracked** chip with the count, a **Manage** link under it, and now shows with no lists at all. A new page, **Tracked contacts** at `/tracked`, groups everyone by their ring state, At risk to Not tracked, with a search, a Name or Recently tracked order, a toggle on every row, how far past its cadence each contact is, and a select mode with Track, Untrack and one cadence for the selection. Settings, Your data lists the page and steps over to it. **Settings → Network and contacts** gains **Track new contacts**, and **Default follow-up cadence** becomes **Default cadence**, a select with the five choices in words. The command palette's action row gains **Track** on `T`, and the `tracked:` facet gets its Yes and No presets and a pill colour.

- **Tracking: the score follows the people you choose (the data and the engine).** A contact is now scored only when a person tracks it. `contacts.isTracked` (off for everyone, new and old) gates both sweeps, the single-contact readers, the weekly snapshot, every Pulse query, the palette's at-risk signal, the AI insight's top and bottom names and the MCP action items. `contacts.trackedAt` records the moment the flag last turned on, written by two database triggers so a route, an MCP tool, a merge and an import all record it the same way, and cleared when it turns off. The cadence is set at the moment of tracking: from the body when it names one, else from the owner's `defaultCadenceDays`, which now offers a year (365) beside 30, 60, 90 and 180. `PATCH /api/contacts/:id` and `PUT /api/contacts/bulk-update` take `isTracked` and `cadenceDays`, and score the contacts that became tracked before they answer, so the ring is right on the next read. `GET /api/contacts/:id/score` answers 404 `NOT_TRACKED` for an untracked contact. A new `trackNewContacts` preference (off) tracks contacts a person adds by hand; imports and connectors never do. The slim list carries `isTracked` and `trackedAt`, the CSV export gains Tracked, Cadence Days and Tracked At, the search accepts a `tracked:yes` and `tracked:no` facet, and MCP `list_contacts` filters by `tracked`, `update_contact` sets `isTracked` and `cadenceDays`, and `get_contact` returns `scoreExplanation: null` for an untracked contact without writing. `shared/cadence.ts` holds the five cadence choices and their words, and `scoreView` in `shared/scoreBand.ts` is the reader every surface moves to in the next step. Nothing on screen changes yet: the ring, the controls and Pulse follow in their own pull requests.

### Changed

- **Slipping is Catch up.** The Up next group used to be fed by the score, under 40, and never read the cadence, which is not what "slipping" meant. It is now the tracked contacts past their cadence, the furthest past due first, ten at most, with the heading "Catch up, 10 of 14" when more wait. The clock is the last interaction, or the moment of tracking when nothing is logged yet. Each row's chip says how far: "3 weeks past due". A catch-up ranks after a birthday. The palette's zero state says the same thing with the same rule: its at-risk signal is now the two contacts furthest past their cadence, "Ada Lovelace, 3 weeks past due". One rule in SQL, `server/services/catchUp.ts`, feeds the list, the count and the zero state, so the two can never disagree about who needs a call.
- **The ring means tracked.** Every surface that shows a relationship score now reads one function, `scoreView` in `shared/scoreBand.ts`, and it answers in three states. A contact nobody tracks shows no ring at all and the picture takes the whole box, so a list of people a person never asked to keep up with reads as a list of faces and not as a wall of empty circles. A tracked contact with nothing logged shows the empty track and "No interactions yet". A tracked contact with a score shows the arc in its band colour. The contact list row's accessible name drops the score words for an untracked contact, and the palette's dot, the peek card's bar, the mention picker, the Ask Contrack results, the archived list and the map's hover card and people list all follow the same reader. The peek card and the map hover card say "Not tracked" where the bar and the chip used to be.
- **The map stops calling strangers at risk.** The health layer painted a red ring for a contact nobody had ever met, because a null score fell into the At risk band, and the hover card printed "Score 50" from the column default. A pin with no score now takes the neutral outline, the legend names it as a fourth swatch, and the stats strip counts it in neither the At risk number nor the average. The cluster arc counts only tracked, scored contacts.
- **The rings on Pulse draw something.** Every ring on Pulse drew an empty track, because the rows carried a score and never the date it was measured against. Up next and the Momentum card now carry the flag, the score and the date, so the arc is the one on the contact's own page. An action item row reads them from the contact cache, which is what the row never had.
- **The score explains itself from the contact page.** A scored ring in the contact header is now the button that opens the breakdown, named "Relationship score 72 out of 100, explain". The only way to reach the five signals used to be the map's hover card, which is the one place a person is not already reading about that contact.

- **The sort menu on the Network page.** Four choices, in the two words each one needs: "A to Z", "Z to A", "Newest", "Oldest". The list orders by a name or by the day a contact was added, each read both ways, and that is all of it. The choice that ordered by the relationship score is gone from the menu and from the "Default sort" preference, which now offers Name and Recent. It was the only choice that needed a sentence to explain it, the score is already on every row as the ring around the avatar, and Pulse ranks by score for a reader who wants that. A stored "score" default reads back as the name order. The menu's trigger shows the order and is named "Sort: A to Z", because "A to Z" alone does not say what the control is.
- **The map on a contact, and every map's chrome.** MapLibre's compact attribution control is born expanded: the moment a style's attributions arrive it lays the full "OpenFreeMap, OpenStreetMap contributors" strip across the map, and it stays until something collapses it. Every map collapsed it on load, so the strip flashed over the picture each time a map opened, which on the contact page is every person a reader steps to. MapLibre's own chrome is now hidden by CSS until the map has loaded, keyed on `data-map-ready` on the wrapper, and the credit is behind the "i" button from the first frame anybody sees. The contact's mini map also waits 250 ms for the pin to hold still before it builds anything, so stepping down the list with the arrow keys no longer builds and throws away a WebGL canvas, a parsed style and a set of tiles for every person passed. The frame holds one still panel until the map reports that it has loaded, and the map fades up through it, so the empty canvas and the tiles painting in are never on screen. The panel no longer pulses.
- **The start panel.** The pane beside the list when nobody is open holds the mark and the words "No contact selected", and nothing else. The line under it telling a reader to pick somebody from the list was saying what an empty pane beside a list of people already says.
- **The corvid on its perch.** The mark at the top of the sidebar is 40 px, against the 24 px of the navigation glyphs below it, because it is the brand and not another stop. Its button keeps the 56 px box it had: the padding pays for the size.
- **The switch.** One `Switch` for every on/off setting, including the five hand-rolled copies in the admin pages. The track is 44 by 24 px and is the button itself, with a 44 px tap box from `hit-area` instead of a square of its own, so it lines up with the other controls on a row's right edge. Off, it is the highest container tone inside a hairline with a 16 px knob in the variant text colour, which the old card-coloured knob was not in the dark palette. On, it is the accent with a 20 px knob and a check inside it, so the state is told by the knob's side, its colour and the glyph. A press swells the knob a little.
- **A setting off its default.** A preference that is not at its default no longer adds a "Changed from the default · Reset" line under its description. The row shows a 6 px accent dot after the title, named "Changed from the default" for a screen reader and a pointer, and a quiet "Reset" text button with a rotate glyph at the start of the control cluster, so the control keeps its place on the row's right edge. `BTN_QUIET` and `CHANGED_MARK` in `src/lib/styles.ts` are the pair, and `.agent/STYLE.md` says they are the only way to show a value off its default.
- **A tighter shape for the whole app.** One radius scale replaces the old tokens that made `rounded-xl` 32 px and `rounded-lg` 24 px: a control is now 6 px, a card 8 px, a dialog 12 px and a chip 4 px, and every `rounded-*` call site follows without a change. Chips, badges, filter pills and the `Segmented` options are `rounded-md` instead of pills. Circles stay for avatars, dots, rings and switch tracks. `.btn-primary` and `.btn-secondary` are 6 px, and the map's zoom group and popup are 8 px. The rules are in `.agent/STYLE.md` under "Radius System".
- **One dropdown, everywhere.** Every list that opens under a control now paints the same solid `.menu-panel` surface (the card colour, a hairline ring, a soft shadow, a 120 ms entrance from the anchoring edge) with the same rows (`MENU_ITEM` and its friends in `src/lib/styles.ts`). The sort menu on the Network page used to be glass over the contact list, and rows showed through its items. A new `Select` component (`src/components/ui/Select.tsx`) replaces the native `<select>`: a `role="combobox"` button that opens a `role="listbox"` panel with the arrow keys, Home and End, type-ahead, Enter, Escape and a click outside, in three forms (a field, the small uppercase label chip on a contact's email or phone, and a ghost trigger for a toolbar), with optional icons, descriptions and groups. The label chips on the contact page, the model picker in AI settings, the "Kind of note" filter in note search and the field picker in the bulk edit dialog use it. `ActionMenu` gained `hint` on an item and a `heading`, slides in from the window's edge when the trigger is closer to that edge than the menu is wide, and scrolls past about ten items. The context menu, the combobox, the snooze menus on Pulse, the map's "Select contacts" and saved views menus, the "Add to a list" menu, the users' row menu, the account panel, the mention list in the composer, the facet suggestions in the command palette and the score breakdown popover all sit on the same panel. The `nice-scrollbar` class, referenced by a dozen scrollers and never defined, now draws a thin bar in the palette's hairline colour.
- **The Network header.** Select, Import and New are icon buttons at every width (an empty square, an upload arrow and a plus), each with an accessible name, a tooltip and a 44 px tap box. "+ New ▾" is now "+". Selection mode keeps the page's title and shows "Select all" and "Done" in the header, and the count, "N selected", leads the bulk bar.
- **The contact list.** The list's scrollbar sits on the left edge, away from the letter rail on the right, so the two no longer share a strip. With the rail on screen the rows stop 2 rem short of the right edge, and the current row is a light tint instead of a 2 px ring with a shadow.
- **The start panel.** The pane beside the list when no contact is open shows the Corvid mark at 144 px, "No contact selected" and one line. The "Up next", "Recently viewed" and "Add people" cards are gone: Pulse is the dashboard.
- **The contact page.** The wide header no longer has a "Log interaction" button, because the composer is the first thing in the Timeline column. Under Location, the address rows come first, then the mini map and its "Open in map" and "Adjust pin" caption, then "+ Add". The About card in the Dossier lost its coloured left bar and its uppercase "Show more": it is a plain card with a neutral heading, a readable measure and a sentence-case text button.

### Removed

- **The map's Health layer.** The layer switch is Pins and Heat. The health ring on a pin, its legend and the red at risk arc around a cluster are gone: a cluster is a count, named "12 contacts, zoom in". A stored `mapLayer` of `"health"`, a saved view with it and an old `?layer=health` link open on Pins: the server reads `"health"` as `"pins"`, in the preference and in `POST /api/map/views`.
- **Code nothing used.** `useAdminUser`, `useSetSearxng`, `fetchSessionPolicy` and `updateSessionPolicy` in `src/api`, the `SettingsView.tsx` re-export, three window events for modals that nothing dispatched (`OPEN_IMPORT_EVENT`, `OPEN_NEW_CONTACT_EVENT`, `OPEN_SMART_PASTE_EVENT`) and the Network list's listener for them, a second bulk edit handler in the Network list, `IconButton`'s `primary` tone, `AISettingsView`'s `embedded` prop, and the swipe overlays' four hand-written gradients, which are the success and error tokens now. Pulse lost the `CardFrame` props `id`, `badge` and `className`, five `UpNextItem` fields and two birthday fields that nothing read, and `MetricCard`'s `onClick`. The map points carry no score, at risk or overdue value.
- **Mapbox geocoding.** Nominatim is the one geocoder now. The map already drew with MapLibre and OpenFreeMap tiles, so Mapbox was left only as an optional geocoder. `MAPBOX_API_KEY` is no longer read, the Mapbox key field leaves the Integrations section of Settings > Administration > General, and `GET /api/admin/integrations` no longer returns a `mapbox` field. `PUT /api/admin/integrations` answers `400` to a body that sends only `mapboxKey`, and ignores that field beside another one. A key stored earlier is deleted from `app_settings` on the next start, so it no longer rides along in backups. The map's React binding is `@vis.gl/react-maplibre`, the MapLibre half that `react-map-gl` re-exported, so `react-map-gl` and its `@vis.gl/react-mapbox` leave the dependencies.
- **`GET /api/dashboard/momentum`, and the Momentum card.** Rising and cooling moved onto the dashboard payload under `tracking`, three each instead of five. The Silent column was Catch up under another name, restricted to people whose score was still above 40, and it is gone. Three numbers nobody read leave `metrics`: `atRiskCount`, `avgDaysSinceInteraction` and `totalInteractions30d`. The `atRisk` list leaves the payload, replaced by `catchUp`. Four files nothing mounted are deleted: `DailyInsightCard.tsx`, `DashboardSkeleton.tsx`, `ActionItemSwimlane.tsx` and `InteractionVelocityModal.tsx`. A stored Pulse layout that names `momentum` drops it and shows Keeping up in its default place.
- **The cadence in the bulk Field dialog.** "Cadence (days)" was a bare number nobody could see anywhere else. The cadence is set when a contact is tracked and changed from the chip on its page, or in bulk from the Tracked contacts page.
- **Two files nothing imported.** `src/components/HealthRingAvatar.tsx` was the old name of `ScoreRingAvatar`, kept as an alias for one release, and the release has passed. `src/views/pulse/NetworkHealthPanel.tsx` was a panel no page ever mounted.

### Added

- **The corvid elsewhere.** The bird now shows up where it means something. `CorvidThinking` replaces three different spinners with one 20 pixel glyph that tilts its head while AI works: the synthesis bar in Ask Contrack, the refresh badge while a contact enriches, and the briefing card while it writes. It names itself "Thinking" where the surface has no words of its own, and stays out of the accessibility tree where a sentence beside it already says so. Pulse sends the bird on a two second swoop across the top of the page under the confetti when the last follow-up clears. The Duplicates queue's "All reviewed" state shows the mark at 96 pixels with one hop as it arrives. The sign in card's mark blinks, and shakes its head for 200 milliseconds when the password was wrong, once per message and for no other error. A phone has no sidebar, so a 20 pixel perch sits at the end of the Settings footer line and flies the same flight. Every one of these reads one rule, `useCorvidLevel()`, so Off, Subtle, the Motion row and the operating system's reduced motion setting each reach all of them.
- **The corvid flies.** The mark on top of the sidebar is now a button named "Contrack". A click, Enter or Space sends the bird off its perch on one 4.5 second lap of the window and back, and it blinks every four to nine seconds while it sits there, with one beat in five a two degree head tilt instead. A new account preference, `mascotMotion`, offers Full, Subtle and Off in a "Corvid motion" row on Settings > Appearance, directly under Motion. Subtle keeps the blinks and the hop and drops the flights. Reduced motion always wins: the row says so when the operating system asks for less motion or the Motion row above it is set to Reduced, and the bird holds still whatever the choice. The flight is one overlay mounted beside the toasts, `aria-hidden` and `pointer-events-none` on a layer below every dialog, panel and menu, so the bird can never cover or swallow a click. Escape lands it at once, a second click brings it straight home, and changing page cancels it. A browser without `offset-path` plays the hop instead. The idle timer never runs while the tab is in the background and never starts for a mark under 24 pixels. The new sidebar stop raises the keyboard Tab budgets by one on the Network and contact pages.
- **Mobile responsiveness for Duplicates, Ask Contrack, and Import.** Streamlined phone layouts and workflows across core tool views. In Duplicates (`/settings/duplicates`), introduced a full-width Segmented control ("Auto scan" and "Manual merge" in sentence case) with unclipped labels at 390 px viewports. Below 640 px, moved Merge activity into the page header action menu to keep the title row uncluttered. Positioned scan mode radio buttons and manual merge checkboxes on the left beside icons, titles, and avatars, and centered cards and result lists within a 48 rem (max-w-3xl) container. In Ask Contrack (`/search`), enhanced the landing empty state when semantic indexing coverage is under 100 percent to display the full SearchCoverageBar alongside a sentence explaining what indexing does, while keeping the compact indicator in the header. In Import (`/settings/import`), restructured the panel so the file drop zone appears first, placed export walkthrough instructions in a collapsible disclosure underneath, and persisted the last chosen import source in browser storage (`contrack.import.lastSource`) with graceful error fallbacks. Verified responsive landing layout in Settings with no back control on mobile. Added dedicated unit tests and Playwright journeys on a 390 px phone project.
- **Map layers and saved views.** Added layer switching and saved views to Map View (`/map`). Users can switch between Pins, Heat, and Health layers via the segmented control or `?layer=` URL parameter, persisting to the `mapLayer` account preference. Heat layer renders a weighted heatmap based on contact interaction count, hiding pins above zoom level 9. Health layer tints pin rings according to relationship health score bands (Strong, Fading, At risk) and displays an accessible legend chip in the bottom-right corner. Introduced multi-tenant `map_views` table with bounds validation, 100-view ceiling (`TOO_MANY_VIEWS`), CRUD endpoints at `/api/map/views`, and full tenancy isolation. Saved views menu enables saving current viewport bounds, active filter query, and layer, with in-place rename and delete modals. Selecting a saved view restores camera bounds, filters, and layer with `?view=<id>` in the URL, prioritizing saved views over remembered camera state on load.
- **Network header, sort menu, and desktop start panel.** Redesigned the Network list header and replaced the empty desktop pane with an actionable start panel. The Network header features explicit "Select", "Import", and "+ New ▾" buttons with visible text from medium screens and 44 px labelled icon buttons on phones. "+ New" uses ActionMenu with options for New contact, Add from text (smart paste), and New list. Selection mode displays the selected count with "Select all" and "Done" alongside the floating BulkActionToolbar. Long pressing any contact row on touch devices enters selection mode. Sorting uses an ActionMenu whose button label reflects the active sort choice, offering five choices (Name A to Z, Name Z to A, Newest first, Oldest first, Score) with checkmark indicator, initialized from the `listSort` preference and persistent across the session. The list filter row renders only when lists exist, eliminating empty pill states. Replaced the empty right pane with `StartPanel`, featuring the Corvid mark and three labelled landmark regions ("Up next" showing top 3 Pulse follow-ups with `ActionRow`, "Recently viewed" with `ScoreRingAvatar`, and "Add people" quick action cards), each with an accessible empty state. Preserved the keyboard Tab budget on network and contact pages.
- **Mailbox (IMAP), Google Workspace, and correspondents review.** Added email and Google Workspace synchronization to the connectors system. Implemented streaming Mailbox (IMAP) adapter (`imapflow` and `mailparser`) supporting TLS/SSL port 993, app passwords, folder monitoring (INBOX, Sent), UID-based incremental syncing, address alias matching, and daily email roll-ups per contact. Implemented Google Workspace adapter (`googleapis`) syncing Google People contacts, Gmail headers/threads, and Google Calendar events via OAuth 2.0 with instance credential configuration, state verification, and refresh token rotation. Added opt-in AI thread summaries (`connectorSummary` task) with prompt injection shielding (`wrapUntrusted`) and a strict 50-item cap per run. Added unconfirmed correspondents review view (`/settings/connectors/people`) with one-click contact creation and sender ignoring (`POST /api/connectors/correspondents/ignore`). Added instance Google OAuth configuration to administration settings (`/settings/admin/general#integrations`) with secret masking and copyable callback URI.
- **Map selection, bulk actions, and hover card.** Added multi-selection and bulk workflow capabilities to Map View (`/map`). Supports box selection via Shift+drag and freehand lasso selection via `L` key or toolbar menu, backed by ray-casting in `mapMath.ts`. Selection operates on actual contacts rather than rendered tiles so contacts inside clusters are properly included. Displays a secondary selection bar with "Add follow-up", "Zoom to selection", and clear controls above the shared `BulkActionToolbar` (archive, delete with undo toast, add to list, field editing, color tagging, and CSV export via `useBulkActions` and `BulkModals`). Introduced `FollowUpModal` with date presets (Tomorrow, 3 days, Next week, custom date picker) creating action items with a 100-contact safety cap. Upgraded cluster badges to show selection proportions (for example, "3 of 12 selected") via an asynchronous leaves cache. Replaced the legacy map popup with `MapHoverCard` featuring a 150 ms tooltip mode on hover or focus and a pinned dialog mode on click or Space with four quick actions (Open, Log note via `QuickInteractionModal`, Add to list, Follow-up), 44 px avatar with score ring, relationship breakdown popover, last contact distance, local time via coordinate lookup, and tags. Added keyboard shortcuts `L` (lasso), `Escape` (clear selection or close card), and `Space` (pin hover card).
- **Connectors framework and Calendar adapter.** Implemented background data connector framework and an iCalendar (ICS) adapter powered by `node-ical`. Features multi-tenant database tables (`connectors`, `connector_runs`, `connector_links`, `upcoming_events`, `oauth_states`), automatic secret sealing via `secretBox`, 60-second polling scheduler with per-owner concurrency controls, and SSRF prevention with private IP checks. Includes meeting/event matching against existing contacts, automatic ghost contact generation at configurable interaction thresholds, and future event sync to `upcoming_events` for Pulse. Added Settings UI at `/settings/connectors` featuring connector cards, manual sync triggers, pause/resume, run history drawer, delete confirmation with imported-data cleanup options, and "via Calendar" timeline source badges.
- **Map stats and insights pane.** Added live viewport analytics, aggregate metrics strip, and an interactive insights drawer to Map View (`/map`). Calculates debounced (150ms) bounding-box stats across contacts currently in view, reporting in-view counts, at-risk and overdue contacts, average health score, time zones, and top rankings for industries, companies, and tags. Introduced `StatsStrip` floating at the bottom left with interactive summary chips that filter on click (e.g. `score:<40`), live status announcements (`role="status"`), and empty state with Fit all. Introduced `MapInsightsPane` as a 320px desktop sidebar and mobile bottom sheet with "Stats" and "People" tabs, supporting keyboard shortcut `i` to toggle, `mapPaneOpen` account preference persistence, virtualized contact browsing via `@tanstack/react-virtual`, and instant fly-to navigation on contact row click. Enhanced cluster markers with an SVG ring badge displaying a proportional red arc for at-risk contacts and updated accessible name (`"${count} contacts, ${atRisk} at risk, zoom in"`). Automatically shifts desktop MapLibre controls when the insights pane is open to avoid control overlap.

- **MCP server.** Implemented in-process Model Context Protocol (MCP) server running Streamable HTTP transport at `POST /api/mcp` (with `405 Method Not Allowed` on `GET` and `DELETE`), powered by `@modelcontextprotocol/sdk`. Exposes 15 tools across contact management, search, timeline logging, action items, pulse metrics, and list management, with multi-tenant isolation, 120/min rate limiting, and operational error code mapping. Registers resources `contrack://pulse` and `contrack://contacts/{id}`, along with prompts `catch_me_up` and `weekly_review`. Added the MCP settings page at `/settings/mcp` with endpoint URL copying, ephemeral token input for host configuration snippets (Claude Code, Claude Desktop, Cursor, curl), and a dynamic tools table.

- **Map filters and place search.** Added real-time facet filtering and place search navigation to Map View (`/map`). Shares the slim contacts dataset with the contact list via TanStack Query client cache, eliminating duplicate fetches. Supports `list:<name|id>` and `near:<place>/<km>` facets alongside standard search facets (`company:`, `role:`, `location:`, `industry:`, `tag:`, `score:`, `updated:`, `missing:`) with instant autocomplete for `list:` and `tag:`. `near:` resolves geospatial coordinates on Enter through a guarded server endpoint `GET /api/geo/search` backed by the existing geocode cache and Nominatim with account rate limiting (30 requests/min). Free text uses the shared `scoreContactMatch` ranking. Introduced `MapToolbar` with a desktop glass panel, interactive facet pills with resolving and error states, "Go to" place navigation (`flyTo` zoom 10 or `jumpTo` under reduced motion), "Fit all" button (`F` shortcut), `/` shortcut to focus search, responsive mobile sheet below `lg`, and empty state handling with one-click filter clearing.
- **Pulse layout customization and controls.** Added customize mode to the three-column Pulse office layout with drag-and-drop column reordering, keyboard navigation, and mobile reorder controls. Users can enter customize mode via the header button or the "C" keyboard shortcut. Each card can be reordered within or across columns via draggable handles or ActionMenu choices ("Move to Focus", "Move to Network", "Move to Intelligence"), or hidden into a dedicated hidden cards tray. Mobile viewports provide 44px accessible Up and Down buttons. Includes reset layout functionality, live aria announcements for layout operations, local preference persistence, and a complete documentation refresh.
- **Profile pictures for accounts (server).** Added `users.avatarUrl` column and endpoints `POST /api/auth/me/avatar` and `DELETE /api/auth/me/avatar` for managing account profile photos. Normalises uploaded photos via sharp (512 px cover JPEG at quality 82 with EXIF rotation and stripped metadata) stored under `uploads/u/<userId>/profile/`. Updated `guardUploads` so any authenticated user on the instance can view profile photos while keeping contact avatars and private files owner-only. Unlinks previous photos on replacement or removal and purges profile folders on account deletion. Note that database backups snapshot the database only, so a restore keeps `avatarUrl` while losing upload files, falling back to initials.
- **Profile pictures for accounts in Settings and UI.** Added PhotoCard to Settings > Account allowing signed-in users to preview, upload, and remove custom account profile photos. Introduced the reusable AccountPhotoField component featuring a 96px circular preview, dropzone file selection with 10 MB limit and inline error messages, and object URL lifecycle cleanup. Updated AccountAvatar to render the custom avatar across the desktop sidebar footer, mobile identity header, and administration user lists, with automatic fallback to monogram initials on image loading error. Note that backups snapshot the database only and do not contain uploads, so restoring an instance from backup falls back to monogram initials until a new photo is uploaded.
- **Profile pictures during account creation.** Users can now pick an optional profile picture when setting up an instance, registering a new account, or accepting an invitation. The AccountFields component renders AccountPhotoField above "Your name" with an explanation caption. The account creation flow uses createAccountThenPhoto to create the account first and upload the photo immediately afterwards, ensuring that any photo processing failure never blocks account creation or sign-in.
- **Harden account profile pictures for performance, stability, and accessibility.** Hardened the avatar upload and deletion lifecycle with database-first atomic updates and asynchronous non-blocking file unlinking, preventing race conditions, stale files, or blocking the event loop on missing disk paths. Replaced synchronous disk stats in avatar processing with sharp output metrics. Fixed PhotoCard in Settings to prevent accidental remote avatar deletion when cancelling a staged local file selection. Enhanced AccountPhotoField accessibility with aria-describedby for inline validation errors and focus restoration to the Choose photo button on removal. In AccountAvatar, dynamically reset error fallback when avatarUrl updates. Added integration and unit tests for concurrent uploads, out-of-band file deletion, and focus management.

- **Pulse charts.** Replaced the temporary MetricCard stopgap in Pulse's Network column with three SVG visualizations. ActivityCard renders a twelve-week activity heatmap with quantile scaling, cell titles, today outline, accessible weekly totals, 40 px sparkline with monthly comparisons, streak counter, and interaction type breakdown pills. MomentumCard surfaces rising, cooling, and silent contacts with score delta chips, row links to contact profiles, and a four-week baseline notice. CompositionCard provides an interactive SVG donut chart with dimension switching for Industry, Role, and Location, legend filter pills linking to facet search queries, and modal deep dives. Includes contrast unit tests ensuring WCAG AA non-text contrast across both light and dark palettes.
- **Instance settings over environment.** Administrators can now configure trash
  retention, backup schedule frequency and keep count, and SearXNG search URL
  directly in the revamped General settings view (`/settings/admin/general`).
  Settings follow a setting over env over default resolution order. When an
  environment variable (`TRASH_RETENTION_DAYS`, `BACKUP_INTERVAL_HOURS`,
  `BACKUP_KEEP`, or `SEARXNG_URL`) is defined, the setting is locked in the UI as
  read-only with source attribution, and update attempts return 409
  `SET_BY_ENVIRONMENT`. The backup scheduler dynamically reschedules its timer on
  interval changes, and the Trash view dynamically displays server-configured
  retention windows.

- **Sign-in front door enhancements.** Streamlined account creation and
  authentication with revealable password fields, Caps Lock detection hints,
  automatic username suggestions, and a visual password strength meter. Setup,
  registration, and invitation acceptance now require only a single password
  input with an accessible 44px reveal toggle ("Show password" / "Hide password")
  and inline "Caps Lock is on" alert. Choosing a password presents a non-blocking
  four-segment strength meter (Short, OK, Good, Strong) evaluating character
  classes, length, and a 40-word common password blacklist. Sign-in introduces
  "Keep me signed in on this device" (default true), where unchecking caps the
  session at `min(policy, 1 day)` with a session-only cookie omitting `Max-Age`.
  Successful sign-ins persist the username in `localStorage`
  (`contrack.lastIdentifier`) to automatically prefill returning visits, focus
  the password field, and display a "Not you?" button to clear the stored account.

- **Password reset and magic-link sign-in.** Self-service password reset and
  passwordless magic-link sign-in backed by single-use hashed auth link tokens.
  Users can request a 1-hour password reset link from the sign-in screen when
  outgoing mail is configured, or view clear operator guidance when mail is off.
  Administrators can email a 24-hour reset link or generate a temporary password
  from the Accounts administration dialog. When enabled by an administrator under
  Instance settings, users can request a 15-minute magic link to sign in
  passwordlessly. Includes the operator recovery CLI script
  `npm run reset-password <username>` (`scripts/reset-password.ts`), hourly
  creation limits per account, 30-day retention cleanup, session method tracking
  (`method: "email-link"`), and audit logging for resets and magic-link logins.

- **Outgoing mail and email invitations.** Administrators can configure
  outgoing SMTP mail either declaratively via `SMTP_URL` and `MAIL_FROM`
  environment variables or interactively through the Outgoing mail administration
  view at `/settings/admin/mail`. Database-stored SMTP passwords are encrypted
  with AES-256-GCM using `secretBox` backed by `CONTRACK_SECRET_KEY` or an
  auto-generated `DATA_DIR/secret.key`. The invitation creation flow now includes
  an option to send invitations directly by email when mail is configured,
  reporting delivery status back to the administrator. Includes a rate-limited
  test email endpoint (`POST /api/admin/mail/test`), read and update endpoints
  (`/api/admin/mail`), and full audit logging for configuration updates and test
  dispatches.
- **The data behind Pulse.** Added `score_snapshots` table with weekly relationship score snapshots, retention pruning at 26 weeks, and weekly sweep tracking. Added deterministic activity aggregates (`GET /api/dashboard/activity`) with 84-day rolling activity, weekly totals, streak tracking, and daily task counts. Added relationship score momentum (`GET /api/dashboard/momentum`) with rising, cooling, and silent contact detection. Added data hygiene metrics (`missingCompany`, `missingLocation`, `missingEmail`, `stale`), upcoming meetings, and correspondent counts to `GET /api/dashboard`. Added `missing:` search facet (`company`, `location`, `email`, `phone`) and birthday normalization utilities. Added `pulseLayout` user preference with column orders and card visibility controls.
- **Passkeys (FIDO2 / WebAuthn).** Accounts can now register biometric
  passkeys (Touch ID, Face ID, Windows Hello, security keys) to sign in
  without typing a password. Includes a first-run nudge interstitial after
  setup or account creation, inline WebAuthn registration and verification,
  browser autofill (conditional UI) on the sign-in form with an abort controller
  handoff for Chrome, and a dedicated "Sign in with a passkey" button. Account
  settings gains a "Sign-in methods" section to inspect and manage passkeys, with
  inline renaming, a removal confirmation dialog, and a device icon naming the
  browser or operating system. Active sessions now track their authentication
  method (`method: "password"` or `method: "passkey"`), displayed under
  Devices in Account settings. Reverse proxies can configure `PUBLIC_URL` to
  ensure consistent rpID and origin derivation during WebAuthn ceremonies.
- **Ask Contrack history pane.** The Ask Contrack search view now includes a
  history pane displaying past search questions organized into Pinned, Today,
  Yesterday, This week, and monthly buckets. Features a 320px desktop aside,
  a mobile bottom sheet modal triggered from the header's History button, the `h`
  keyboard shortcut for quick toggling, one-click search re-running, row pinning,
  deletion with undo toasts, live query filtering, and a confirmation dialog
  for clearing history. Account preference `askHistoryOpen` persists the pane
  visibility across sessions.
- **Search history table and API.** The server now stores every question asked
  per account across People, Notes and palette modes in a dedicated
  `search_history` table. Distinct queries per mode are deduplicated by
  normalised text, with automatic run counting, last run timestamps, pinned
  flags, and result snapshots. Five new scoped and isolated routes under
  `/api/search/history` support listing with cursor pagination, recording,
  pinning, individual deletion, and clearing history by mode or entirely.
  Legacy search history from user preferences is automatically backfilled on the
  first request for an account with no history rows.
- **Search history management in Settings.** Settings > Privacy and AI now
  includes a "Search history" row (`#search-history`) displaying the total
  number of recorded questions and a "Clear history" action with confirmation
  dialog. The row is searchable via the settings registry with keywords
  `history`, `recent`, and `searches`.

- **Settings revamp: registry, two-pane shell, and row search.** Settings is now
  driven by a declarative registry (`src/views/settings/registry.ts`). On wide
  screens (1024px and wider), settings renders as a two-pane shell with a 240px
  rail on the left and the active page on the right. On phones, it retains the
  single-pane list with instant back navigation. Live row search searches titles,
  descriptions, and keywords across all pages with keyboard navigation and hash
  links. Individual setting rows flash and focus on navigation, display a dot
  indicator when modified, and provide a reset button. Old settings URLs redirect
  to their new paths. `DELETE /api/auth/preferences/:key` allows resetting
  preferences to defaults.
- **Personal preferences and dedicated settings pages.** Added 9 personal
  preferences (`startPage`, `listSort`, `defaultCadenceDays`, `weekStart`,
  `showWeather`, `textScale`, `motion`, `singleKeyShortcuts`, and `aiAssist`)
  with persistent account-level storage. Added four dedicated settings pages:
  Appearance (theme, accent, text scale, motion, list density), Network and
  contacts (default start page, default sort order, recent contacts limit,
  default cadence, week start, weather forecast toggle, temperature unit),
  Keyboard shortcuts (toggle switch for single-key shortcuts and complete
  reference table), and Privacy and AI (account-level AI toggle, data privacy
  transparency cards, and links to AI usage). Turning off AI for an account
  disables generative AI endpoints with 403 AI_OFF_FOR_ACCOUNT and suppresses
  client AI action buttons while preserving fast local search and retrieval.
- **Tools and data settings: Import, Tags, Duplicates, and Contact enrichment.**
  Settings gains dedicated tools and data management pages and live count badges.
  A Needs attention banner on the Settings landing page displays up to three
  action items for pending duplicates, un-enriched contacts, and failed imports.
  The Settings rail reflects live counts on Duplicates, Tags, Enrichment, and
  Import pages. Added a dedicated Import page (`/settings/import`) with an inline
  workbench, recent imports history table, and failed row retries. Added a
  dedicated Tags page (`/settings/tags`) with contact counts, alphabetical
  browsing, inline tag renaming, merge tag modal, and bulk deletion. Added
  automatic duplicate check preferences (`dedupeOnCreate`, `dedupeOnImport`) and
  an active duplicate count strip on the Duplicates page. Added a never-enriched
  contact banner, one-click preselection for batch enrichment, automatic contact
  enrichment preference (`autoEnrich`), and live grounding meter on the Contact
  enrichment page. Added backend endpoints for listing imports (`GET /api/imports`),
  summarizing tags (`GET /api/tags/summary`), renaming tags (`PATCH /api/tags/:tag`),
  and deleting tags (`DELETE /api/tags/:tag`).
- **The corvid, everywhere.** One drawing of the raven, traced by hand from
  `docs/brand/corvid-source.jpg` into `src/assets/corvidPaths.ts`, is now the
  mark. It replaces the gradient "C" in the tab strip, the PWA and Apple
  icons, the rotated word in the sidebar, the icon square on the sign-in
  card, the empty Network, Trash and Archived screens, the "No Contact
  Selected" pane, the crash screen's footer and the README header.
  `npm run brand:icons` renders every icon in `public/` from that one file,
  adds a maskable icon for Android launchers and a 1200 by 630 link preview,
  and a unit test fails when the committed favicon and the drawing disagree.
  In the app the mark strokes with `currentColor`, so it follows the accent
  a person chose, and its eye keeps the new `--color-corvid-eye` token. The
  icon links carry `?v=corvid` so a browser that pinned the old favicon
  fetches the new one, and the manifest's theme colour is the current
  primary, `#006a91`. The mark is decoration in this phase: it is hidden from
  assistive tech and takes no Tab stop. See `.agent/STYLE.md` section 6.
- **A map that opens where you left it, and knows what covers it.** The map
  page keeps its MapLibre map alive between visits and writes its view to
  `localStorage` when a move ends, so a return to the map, and a reload,
  open on the same spot at once. The map's code is warmed in an idle moment
  on whichever page opens first, unless the browser asks to save data, and
  the build now keeps MapLibre out of every other page: React and Vite's
  preload helper had been folded into the map's chunk, and every page
  preloaded a megabyte of MapLibre to get them. The open contact and the
  phone's tab bar are measured as covers and passed to MapLibre as padding,
  so a contact opens beside its pin instead of over it, and a pin on a phone
  settles above the bar. The hover card stacks above every pin and opens on
  the side with room, and it does not open for a touch. The attribution
  opens collapsed. The map no longer rotates by touch or by key.
- **A pin you can move by hand, and a basemap you can host yourself.**
  "Adjust pin" under the map on a contact opens a dialog with that person's
  pin on an interactive map. Drag it, click the map, or nudge it with the
  arrow keys, and Save. The new `PATCH /api/contacts/:id/location` route
  writes the coordinates and marks the row `geoSource = 'manual'`, and the
  geocoder leaves it alone from then on: its write skips a manual row, the
  startup sweep leaves the row out, and an edit to the contact asks the
  geocoder again only when it changes the address the pin stands for. "Use
  address again" hands the pin back. A pin a person placed shows "Placed by
  hand" with an InfoTip, and `GET /api/contacts/map` now says who placed each
  pin. "Set location" opens the same dialog for a contact the geocoder could
  not place. The `pmtiles://` protocol, registered since the MapLibre swap,
  now has its worked example: `docs/features/map-view.md` shows a style under
  `public/map/` that reads one `.pmtiles` archive from this origin, and the
  `MAP_STYLE_*` override that points the map at it, with no request leaving
  the instance.
- **A map on the contact page, and the map page opens on the person you
  asked for.** A placed contact shows a 160 px still map of where they are,
  under their addresses, with their pin on it. "Open in map" and a "Show on
  map" link beside each address both lead to `/map/contact/<id>`, and the map
  page now flies to that contact over 800 ms and stops at zoom 11, or stays
  closer if it already was. A reader who asked their system for less motion
  gets the same view without the animation. A contact with an address the
  geocoder has not placed reads "Not on the map yet" and loads no map at all.
  The mini map is a region named "Location map", so the two maps on
  `/map/contact/<id>` stay two landmarks a reader can tell apart, and its
  picture stands down there because the map behind the panel already holds
  the pin.
  See `docs/features/map-view.md`.
- **Two floors: 44 px targets and 11 px text.** Every control a finger can
  reach now has a tap box of at least 44 by 44 pixels on a phone, and no text
  is smaller than 11 pixels. The new `hit-area` utility grows a small control's
  tap box without changing how it looks. The phone tab bar labels, the label
  and badge tokens, the shortcut chips and 138 other lines moved from 9 or 10
  pixels to 11. `tests/unit/styles.floor.test.ts` fails on `text-[9px]` and
  `text-[10px]`, and `tests/e2e/metrics.spec.ts` measures both floors on a
  390 pixel phone on Network, a contact, Pulse, Ask Contrack and Settings.
- **One empty state.** `src/components/ui/EmptyState.tsx` draws every empty
  screen the same way: a 48 px icon tile, a title, one sentence and at most
  one action. Network, Pulse, Possible duplicates, Trash, Lists, Ask Contrack,
  Contact enrichment and AI usage use it, with new copy that says what to do
  next. Its `illustration` slot is where the corvid mark goes.
- **A colour for AI-derived data.** `--color-ai` marks what a model wrote: the
  interests and tags an enrichment run added and the note glyph on the
  timeline. It is defined in both palettes, clears WCAG AA on every surface,
  and does not follow a contact's colour. The composer's selected type no
  longer uses it.

- **The contact list is one Tab stop.** Up and Down move through the list,
  Home and End jump to the ends, a letter jumps to the next name that starts
  with it, and Enter opens the contact. The letter rail is one stop too, with
  the arrow keys inside it, and it draws only the letters that have contacts.
  From the top of a contact page the contact's name is now at most 16 Tab
  presses away. It was 42. `keyboard.spec.ts` holds that budget.
- **Focus follows navigation.** Opening a contact puts focus on its name, and
  Back on a phone puts focus on the row it was opened from. The skip link
  follows the route: the contact's name on a contact page, the list on the
  Network page.
- **Landmarks and headings on every route.** Each route renders inside a
  named `main`. On a wide screen the list is a "Contacts" landmark beside the
  contact. On a phone the list is the main. Network, a contact and the map
  each have an `h1`, and the contact's name is that `h1`. The axe suite now
  checks `landmark-one-main`, `page-has-heading-one`, `region` and
  `heading-order` on six screens, and on a phone for the list and a contact.
- **One name per destination.** `src/lib/names.ts` holds the names, and the
  sidebar, the tab bar, the command palette, the shortcuts dialog and the
  document titles read them. "Relationship Pulse" is now "Pulse". "AI Search"
  and "Ask AI" are now "Ask Contrack". "Network Dedupe Engine" is now
  "Duplicates". The batch research page is "Contact enrichment", and its button
  says "Start enrichment".
- **A shortcut registry.** `src/lib/shortcuts.ts` lists every shortcut with
  its group, keys, description and a `bareLetter` flag. The shortcuts dialog
  renders from it, and a unit test fails when two shortcuts in one group
  claim the same keys. The dialog now lists the contact list's keys.

- **Browser accessibility checks in CI.** A `browser-a11y` job builds the
  production bundle, boots it the way a release runs, and drives it in
  headless Chromium with Playwright: axe scans of every screen against WCAG
  2.2 AA in both palettes, and journeys for the keyboard, dialogs, search
  announcements, forms on a phone, and the account transitions on a gated
  instance. Each worker boots its own server on a throwaway data directory.
  `npm run test:e2e` runs it locally. See `docs/accessibility.md`, which
  also carries the manual keyboard and screen-reader pass that supplements
  the automated one.
- **The search page announces itself.** One polite status region says that
  a search started and what it found, for People and for Notes, and a failed
  search is an alert. Results restored on the way back to the page are not
  read again.
- **A skip link.** The first Tab stop on every page is "Skip to main
  content", which moves focus past the sidebar or the tab bar.

### Fixed

- **A fast second arrow key in the Network list was lost.** The list's keydown listener was attached again in an effect after every change, and an effect runs after the browser paints. A second ArrowDown pressed in between ran the old listener, which still had no open contact, so it reopened the first row. The listener is attached once now and reads the latest values from a ref written in the commit.
- **A link's platform came from anywhere in its text.** `detectPlatformFromUrl` matched `includes("x.com")`, so dropbox.com and netflix.com were saved as Twitter, and a LinkedIn address in a query string made any link LinkedIn. It reads the host now, the domain or a subdomain of it, and knows YouTube.
- **Clearing a note search left its notes on screen.** The search kept the last answer while the next one loaded (`keepPreviousData`), and a cleared search asks nothing, so the old answer stayed for good. An empty search now holds no answer, and Clear and Escape empty the notes with the words and the filters.
- **A note search recorded the answer to the question before it.** The history entry was written when the query reported success, and a new question reports the previous answer while its own loads. It is now written once, from the question's own answer.
- **The arrow keys in radio groups.** Twelve groups built from buttons with the radio role did nothing with the arrow keys: nine in Settings (the session length, trash and backup presets, an invitation's role and expiry, a token's expiry, an account's role and the password reset) and the primary contact in the duplicate review's three views. In the General presets only the chosen option was a Tab stop, so a keyboard could not pick another one at all, and a stored value that matched no preset left the group with no Tab stop. `radioKeys` and `radioTabIndex` in `src/lib/a11y.ts` give each group one Tab stop and the arrows, as `Segmented` and `AccentPicker` already had.
- **The switch's knob slides again.** It transitioned `transform`, and Tailwind's translate utilities set the separate `translate` property, so the knob jumped from side to side.
- **Two rows lit in a menu.** A menu opened by a click focused its first row, and the pointer tinted another, so the New menu and every kebab showed two current rows. The row under the pointer now takes focus, as in the system's own menus (`focusOnPointer` in `src/lib/a11y.ts`), in the action menus, the selects and the map's saved views.
- **Closing Add from text opened the New contact form.** The dialog's close and its success shared one callback, so the X, Escape and the overlay all opened the form. Closing now only closes and gives focus back to the control that opened the dialog, a successful extraction opens the form filled in, and a result that arrives after the dialog closed is dropped.
- **The AI summary on Ask Contrack could not see industries.** `POST /api/search/synthesize` sent each person's name, role, company and location and not the industry, while the prompt told the model to check the query's industry against the facts. A fintech question got a summary saying nobody works in fintech. The industry is a labelled field now.
- **The sort menu under the selected row.** On the Network page the sort menu opened under the selected contact row and looked transparent: the header is `sticky z-10`, the selected row is `z-10` too and comes later in the page, so the row painted over a panel drawn inside the header whatever z-index the panel carried. `ActionMenu` and `Select` now open their panel in the browser's top layer through the Popover API (`usePanelPlacement`), where nothing on the page can paint over it and no scroller can clip it. The panel stays in the DOM under its trigger, so a click inside it is still inside the trigger's wrapper and a dialog's focus trap still sees its rows. A scroll that moves the trigger closes the panel, and so does a resize.
- **Escape in a list inside a dialog.** Escape on a row of the field picker in the bulk edit dialog, or of any menu inside a dialog, closed the dialog as well as the list. The dialog listens for Escape on the document in the capture phase, so a handler on the rows ran too late. The panel now takes Escape in the window's capture phase, closes itself, returns focus to its trigger, and the dialog stays.
- **A third journey that left something behind.** The map's box-selection journey added two follow-ups to seeded contacts and never took them off the worker's shared instance, so Pulse read one of them as the second row of "Up next" and the phone metrics scan measured them. All three passed or failed by the order Playwright happened to choose. The journey now deletes what it adds.
- **Two targets the browser suite only met by chance.** The contact's name on a Pulse follow-up row was a 16 px link with no tap box, and the Rename and Delete buttons on a saved view in the map's views menu were 22 px buttons inside a `role="menu"` that did not know them. The link has a 44 px tap box, and the two buttons are 24 px menu items the arrows reach. Both only showed when another spec had left a follow-up or a saved view on the same worker's instance, so the suite passed or failed with the order Playwright chose.

### Changed

- **Unified command palette search history.** The command palette now reads
  and writes from the unified `search_history` database table alongside Ask
  Contrack instead of the `preferences.searchHistory` blob. Palette queries are
  recorded under the `palette` mode while `?` AI queries map to `people` mode.
  Terminal-style history navigation (Arrow Up and Arrow Down) recalls recent
  queries across all modes. The client stops writing to `preferences.searchHistory`,
  though the server continues to accept the legacy key for one release.
- **A timeline in one column.** The contact timeline used to zigzag, with
  cards on alternate sides, so at 1440 px each card was 250 px wide and its
  title wrapped to three lines. Entries now sit in one column, newest first,
  in groups: "This week", then one group per month ("August", or "December
  2025" for an earlier year). Each entry shows a 64 px date column with the
  day and short month, the type glyph, the title as a button that opens the
  interaction, and the body cut at three lines. The full date is the entry's
  tooltip. The red trash icon on every card is gone. A menu with Edit and
  Delete shows on hover, on focus, and always on a touch screen, and the
  interaction dialog has Delete too.
- **Delete an interaction, then undo it.** Delete asks first, and then a
  toast offers Undo for 10 seconds. The server delete is permanent, so the
  app sends it only when the toast closes. Undo sends nothing, leaving the
  page does not cancel a waiting delete, and closing the tab sends it.
- **The contact page follows the width of its own pane.** From 768 px the
  header sits over two columns: Details on the left, in view while it fits
  the window, and Timeline or Dossier on the right. Under 768 px (a phone, or
  a 1024 px window with the list beside the contact) the header is about 140
  px: a 56 px avatar, the name, the role and company, and one meta line. A
  Timeline, Details and Dossier control sticks under the Back bar, the
  composer is one line above the first entry until it takes focus, and Save
  sticks above the phone's tab bar while a note is written. The headline, the
  summary, the tags and the lists move to the Details tab. Back now says where
  it goes: "Network", "Map" or "Archived contacts".
- **The ring around an avatar is the relationship score.** It used to be the
  contact's colour, and a red ring read as trouble. The arc length is now the
  score, and its colour is the band: Strong (70 and up), Fading (40 to 69) or
  At risk (under 40). A contact with no logged interaction shows an empty ring
  and "No interactions yet". The tooltip says the score in words, and each
  contact row's accessible name ends with it, for example "score 72,
  strong". The ring is 2 px in lists and 3.5 px in the header, and a photo
  shows with no grey disc behind it. The bands live in `shared/scoreBand.ts`,
  which the server's at-risk counts and the command palette read too, so the
  palette's "Moderate" is now "Fading". `HealthRingAvatar` is now
  `ScoreRingAvatar`, and the old name stays as an alias for one release. The
  contact's colour is only the accent on its own page.
- **One date format.** Absolute dates use `formatDay` (or `formatWhen` where
  the time matters) across the contact page, the contact list, archived
  contacts, Pulse, AI usage and Ask Contrack, in the reader's locale.
- **A contact header with one primary action.** The name is followed by the
  role at the company on one line, and then a meta line of plain facts: the
  location, the person's local time and the weather. Social links and the
  website follow as links with a `↗` glyph that open in a new tab, each with
  its own small menu. Tags are chips with a "+ tag" button. The header shows
  one primary button, "Log interaction", which opens the Timeline tab and puts
  focus in the composer. Every other action is in "Contact actions": Change
  colour, Change avatar, Copy basic details, Copy full details, Archive and
  Delete, with Delete last on its own surface tone. The palette icon, the
  archive icon, the avatar's hover button and the unlabelled sparkle are gone
  from the header. The menu follows the menu pattern: focus moves into it,
  the arrow keys, Home, End and a first letter move, and Escape returns to the
  button. The colour picker opens from the menu as a radiogroup named
  "Contact colour". The weather is fetched only when it is shown, so the
  settings revamp's switch can turn the request off with it.
- **The briefing lives in the Dossier tab.** A "Briefing" card at the top of
  the tab offers "Generate briefing", shows the three points inline with when
  they were written, and offers "Regenerate briefing". A briefing that fails
  says so in the card. It used to be a 28 px sparkle beside the company that
  opened a modal and, on an error, showed a spinner that never ended.
- **One pattern for every detail.** Each value in the Details card is a
  `Field`: a 12 px sentence-case label, the value, its label select and a row
  menu, and a "+ Add" button under the list. A value edits in place with a
  click or Enter, and Escape cancels. A pencil after the value shows at 40
  percent on a touch screen and on keyboard focus. The row menu holds Make
  primary, Show on map (address rows) and Remove, and the first address
  says "Map pin" in plain text. A row moves with Alt+Arrow Up and Alt+Arrow
  Down, a screen reader hears its new position, and the drag handle shows
  while the row's menu is open. The label select is a 32 px chip at every
  width. Tags, preferences and interests share one `ChipInput`, and removing
  a preference or an interest now offers Undo too. Birthday and Industry are
  real buttons with the same pencil. The italic "Add another", the
  underlined bare inputs and the per-row "Show on map" link are gone. The
  shortcuts dialog lists Enter, Escape and the Alt+Arrow moves under a new
  "Contact" group, and ⌘ Enter under Global.
- **One composer.** `InteractionComposer` replaces `RichInteractionComposer`
  and the textarea inside `QuickInteractionModal`. The quick interaction
  dialog now has @mentions and the next-action line too. The type is a
  radiogroup, Note, Call, Meeting and Email, with text from `sm` and icons
  below. Save is always enabled: a Save with nothing written says "Write
  something first" and moves focus to the editor, and in the dialog a Save
  with no contact says "Choose a contact first". A "⌘ Enter to save" hint
  sits at the end of the next-action line, and ⌘ Enter works from that line
  as well as the editor. The mention list opens inside the dialog, where it
  can be clicked, and its avatars fit their rows. `QuickInteractionModal` keeps `isOpen` and `onClose` and gains
  `initialContactId`, which opens it for one person without the contact
  search. The dialog loads the composer only when it opens.
- **The map is MapLibre GL JS on OpenFreeMap vector tiles.** Leaflet, its
  cluster plugin and the raster basemap are gone. The basemap is OpenFreeMap's
  `positron` in the light palette and `dark` in the dark one. Neither needs an
  API key or registration, and neither sets a request limit. MapLibre clusters
  the pins itself, so a click on a cluster zooms to where it splits. A cluster
  of people the geocoder placed on one point cannot split, and it opens a list
  of those people instead, so a stacked pin stays reachable. Every pin is a
  button named `"<name>, <company>"`, and every cluster a button named
  `"<n> contacts, zoom in"`. The markers are React components now, not HTML
  strings, and the map is a region named "Contact map". `MAP_STYLE_LIGHT` and
  `MAP_STYLE_DARK` point either palette at another style, as an absolute https
  URL or a root-relative path such as `/map/style.json`.
  `GET /api/auth/status` reports the pair as `map`. The production CSP adds
  `worker-src 'self' blob:`, `child-src blob:` and each style's origin in
  `connect-src`. A root-relative style adds no origin, so a self-hosted
  basemap is a config change and not a code change, and the registered
  `pmtiles://` protocol lets such a style read one `.pmtiles` archive.
  `GET /api/contacts/map` now also leaves out trashed contacts and ghosts. See
  `docs/features/map-view.md`.
- **One button shape.** `.btn-primary` and `.btn-secondary` are rounded
  rectangles, 44 px tall on a phone and 40 px from `sm`, with one disabled
  look. Every primary and secondary call-to-action uses them. Pills are for
  chips, filter pills and `Segmented` only, and the floor test fails on a
  filled primary pill anywhere else.
- `Segmented` options are 44 px tall below `sm`. Accent swatches are 36 px
  with a 44 px tap box.

### Fixed

- A date with no time, such as a birthday stored as `1974-05-10`, shows on
  its own day. It was read as midnight in UTC, which is the day before
  anywhere west of Greenwich.
- Typing `@` in the composer finds people even when the contact names had not
  loaded when the editor was created. The editor kept the list it was created
  with, which could be empty.
- An inline edit closed with Enter or Escape gives focus back to the value.
  Focus used to fall to the page.
- ⌘⇧I opens the quick interaction dialog when the browser reports the key as
  a capital "I".
- The temperature on a contact arrives at its full colour. It used to fade in
  from nothing, which is text below its contrast for as long as the fade
  lasts, and an accessibility scan that started in that window read it as a
  failure. It now grows into place at full opacity.
- Controls that had only a `title` now have an accessible name: the Select
  button on Network, each "Remove" button on a contact's details (it names the
  value), the Note, Call, Meeting and Email type buttons in the composer, and
  the back link on the Duplicates page. The sidebar wordmark is hidden from
  screen readers.
- The note editor has a name, "Note", and its placeholder as a description.
- The Instance health page's definition lists hold only terms and
  definitions, which clears the axe `definition-list` failure.
- The shortcut chips in the command palette meet contrast at 11 pixels.
- Heading levels no longer skip: the Import dialog's sub-heading is an `h3`,
  the Ask Contrack coverage card is an `h2`, a contact's Details card is an
  `h2`, and the timeline entries are `h3`.
- The keyboard shortcuts overlay is a dialog now: it has the role and the
  name, traps Tab, and returns focus to the button that opened it. It was a
  bare overlay with an Escape handler.
- The contact card that opens over search results has the same: role, name,
  focus moved in, Tab kept inside, focus returned to the result on close.
- The quick interaction dialog is named "Log an interaction" rather than
  "Dialog".
- Form fields render at 16 pixels on a phone, so iOS Safari no longer zooms
  the page when one takes focus.
- On the Network page, Enter on a focused link or button activates it
  again. The list's Enter-to-compose shortcut swallowed every Enter outside a
  field, so a keyboard user who tabbed to a sidebar link and pressed Enter
  went nowhere.
- The open contact's row is marked current again, with its ring and
  `aria-current`, and the j/k keys step from it. The list is mounted on the
  catch-all route, so the route parameter it read was always empty and
  every ArrowDown went to the first contact.
- Switching to Notes with the arrow keys keeps focus on the People / Notes
  switch, as a radiogroup promises, rather than jumping into the field.
- The inline help and score-breakdown buttons are at least 24 pixels, the
  WCAG 2.5.8 floor for a target. The icons are the size they were.
- The timeline's drop target and the avatar picker's file input have names.
- Leaflet's attribution links are underlined, so they are told apart from
  the text beside them by more than colour.
- With "reduce motion" on, staggered tiles no longer wait their turn at
  opacity zero before appearing at once.

- **Note search.** Ask "Who discussed hiring last month?" and get the notes
  that say so, each with the person it is about, the date, and the passage
  that matched. A new FTS5 table, `interactions_fts`, indexes note titles and
  bodies as plain text, with stemming and diacritic folding, and three
  triggers keep it in step with every write in the note's own transaction. A
  date phrase in the question (`last month`, `since March`, `in 2025`, `the
last 30 days`, …) is read locally, in the caller's time zone, and applied
  as a filter; nothing here calls a model. `GET /api/search/interactions`
  answers with the hits, highlight offsets, the total, and what it understood.
  The search page has a Notes mode beside People, with period presets, a kind
  filter, and paging, and a result opens the note on its contact's timeline.
  Notes on archived, trashed, merged and ghost contacts are hidden. See
  `docs/features/interaction-search.md`.
- Every bulk import has an id and a record. The browser makes the id when a
  file is chosen and sends it as `X-Import-Id`, and `imports` keeps a row per
  import and `import_rows` a row per contact. A second request with the same
  id writes nothing and answers from the record, so a dropped connection
  followed by a retry never creates the contacts twice. `GET /api/imports/:id`
  reads the record, and a browser that lost its stream polls it rather than
  showing "Import Complete" over an import it knows nothing about. A record
  whose server process died settles on the next read: one that never saved a
  contact is reported failed, and one that saved its contacts but never
  finished the duplicate check is finished then.
- A row that fails no longer fails the import. The rest of the batch is
  saved, the row is kept with its error and its payload, and
  `GET /api/imports/:id/rows` lists it. `POST /api/imports/:id/retry` runs
  the failed rows again from what the server kept, without the file being
  sent a second time. Finished imports are swept after thirty days.
- An import can be reconnected to and retried. The browser makes an id for
  each file it imports, sends it as `X-Import-Id`, and remembers it per
  account. A stream that ends without the server's `done` frame no longer
  shows "Import Complete": the modal polls `GET /api/imports/:id` until the
  server says `complete` or `failed`, and shows the summary the server
  confirmed. A dead connection, a 409 for an import already running, and a
  reload part way through all lead to the same record, and "Try again" sends
  the same contacts under the same id, which the server treats as one import.
  Rows the server could not write are listed on the summary with the reason
  and retried through `POST /api/imports/:id/retry` without the file.
- **Phase 3.** An administrator can manage the accounts on the instance.
  `GET`, `POST`, `PATCH` and `DELETE /api/admin/users` list, create, change
  and remove accounts, `POST /api/admin/users/:id/disable` and `/enable` turn
  one off and on again, `POST /api/admin/users/:id/reset-password` issues a
  new temporary password, and `GET /api/admin/users/:id/export` downloads one
  account's data for the person who is leaving. Every one of them needs an
  admin account.
- **Phase 3.** Invitations. `POST /api/admin/invitations` returns a link once,
  `GET` lists them with their status, and `DELETE` revokes one. The person
  uses the link at `POST /api/auth/accept-invitation`, which creates their
  account with the role the invitation carried and signs them in. There is no
  mail: the database holds only the hash of the secret in the link, and the
  admin sends the link however they already talk to the person.
- **Phase 3.** An audit log. Every administrative action writes one row:
  creating, inviting, disabling, enabling, deleting and exporting an account,
  changing a role or a password, changing an instance setting, taking a
  backup, and every sign-in and sign-out. `GET /api/admin/audit` pages through
  it newest first. Details never carry a password, a token, an invitation
  secret or a provider key, and the service redacts a credential-shaped field
  rather than trusting each call site.
- **Phase 3.** A forced password change. An account created or reset by an
  administrator holds a password that administrator chose, so every data route
  answers `403 PASSWORD_CHANGE_REQUIRED` until the person replaces it. Their
  own account settings stay reachable, which is where the change happens.
- **Phase 3.** Personal API tokens. `POST /api/auth/tokens` mints one,
  `GET` lists them with enough of each to tell two apart, and `DELETE`
  revokes one. A token acts as its own account everywhere that reads owned
  data, so an MCP client signed in with one reads the contacts of whoever
  issued it. It cannot reach any route that manages the account, which means
  a script can neither mint a second token nor change the password that would
  revoke its own.
- **Phase 3.** Open registration, off by default. `POST /api/auth/register`
  answers `403 REGISTRATION_CLOSED` until an admin turns it on through
  `PUT /api/admin/settings`, and the account it creates is always a member.
- **Phase 3.** `GET` and `PUT /api/admin/settings` hold the instance
  settings: open registration and the session lifetime.
  `PUT /api/auth/session-policy` writes the same session value and is
  deprecated.
- **Phase 3.** A second rate limit on the AI routes, per account rather than
  per address, at thirty requests a minute. On a multi-user instance behind
  one office address the older per-address limit let one person spend
  everybody's provider budget. `GET /api/dashboard/insight` and
  `POST /api/dedupe/scan` join the list both limits cover, and a `429` from
  either now carries a `Retry-After` header.
- **Phase 3.** One daily maintenance sweep, gated by
  `DISABLE_BACKGROUND_JOBS`. It removes audit rows past ninety days, expired
  sessions, tokens revoked more than thirty days ago, invitations that died
  more than thirty days ago, and AI invocations outside the stats window.
  Before this the invocation cleanup ran once at boot and the session sweep
  was boot-only, so an instance left running for a year swept twice.
- **Phase 3.** `?scope=all` on `GET /api/ai/stats/summary` and
  `/feed` gives an admin the instance totals and a per-account breakdown,
  because the provider key is one key and the bill is one bill. A member
  asking for it gets `403 ADMIN_REQUIRED`. The instance feed names the
  account behind each call and omits the description, which is the one field
  that can carry a fragment of what somebody asked about.

- **Phase 4.** An administration area, for admins only and downloaded only by
  them. Accounts (create, invite, edit, reset a password, disable, export,
  delete), Invitations, Instance (who can join, how long a sign-in lasts, the
  AI configuration and SearXNG), Backups, and the Audit log with a filter and
  paging. Each is a separate chunk, so a member never fetches five pages of
  account management to be told they may not open them.
- **Phase 4.** Backups have a UI. The service has taken snapshots and rotated
  them for years and nothing in the app has ever shown one, so the only way to
  know it was working was to look in the data directory.
- **Phase 4.** AI usage gained a **Mine / All users** control for admins, with
  a per-account breakdown of calls, tokens and cost. The provider key is one
  key and the bill is one bill. A member sees only their own, and asking for
  the instance view without an admin account is a `403`.
- **Phase 4.** Deleting an account shows what it owns before it goes. The
  first click is refused with `409 USER_HAS_DATA`, the counts in that refusal
  are what the dialog shows, and the delete needs both an explicit checkbox
  and an "export their data first" button beside it.

- **Phase 4.** The sign-in flow covers every way an account starts. A new
  instance is set up; an instance that has been running without sign-in is
  _secured_, and the screen says so and explains that the contacts already
  there stay with the account it creates. An invitation link opens a join
  screen, open registration adds a "Create one" link to sign-in, and an
  account holding a password an administrator chose is sent to a screen that
  replaces it before anything else works.
- **Phase 4.** The app knows who is signed in. `useAuth()` carries the account,
  its role, whether the password must change, and what the instance allows,
  and it is available on every screen rather than only after the gate opens.
  The signed-in account appears at the foot of the sidebar on desktop, with a
  menu holding the account settings and sign-out, and at the top of Settings
  on a phone. All of it hides on an instance that asks nobody to sign in.
- **Phase 4.** An API tokens section in Account settings. Create a token and
  see its value once, read the list with the last time each was used, and
  revoke one. A banner appears while the deprecated environment `API_TOKEN`
  is still set, naming the variable to remove.
- **Phase 4.** A dedupe scan behind another account's says so. The scan is
  booked on the server and starts by itself, and the page says that rather
  than showing a progress bar at zero. `GET /api/dedupe/active` gained a
  `queued` field, which is the only way a reloaded page can tell a booked scan
  from one that has hung.
- **Extra F3.** An instance name. One setting, 60 characters or fewer, shown
  on the sign-in and join screens, in the account menu, and in the browser
  tab. Somebody clicking an invitation arrives at a screen belonging to an
  instance they have never seen, and a hostname is not an answer to "whose
  Contrack is this". Set it under Administration, Instance. Leaving it empty
  shows the product name, exactly as before.
- **Extra F4.** `/healthz` reports the schema versions this database is on,
  beside the versions this build expects, so an operator can confirm a
  migration ran without opening the database or signing in. Version numbers
  and nothing else: the endpoint answers without a credential, so it carries
  no counts, no configuration and no accounts.
- **Extra S9.** An instance health panel, at Settings, Administration,
  Instance health. `GET /api/admin/health` answers what an operator needs when
  several people share one instance: the schema versions this database is
  actually on, the database and write-ahead log sizes, the newest backup and
  whether it verified, which account the dedupe scan is running for and who is
  waiting behind it, how much of each account's contacts the search index
  covers, the AI cache hit rates, and the provider's tier and paused models.
  Every one of those was answerable only by reading the server log or opening
  the database. `/healthz` is unchanged and stays two states and no detail: it
  answers without a credential, and an unauthenticated endpoint must not
  describe the instance.
- **Extra F1.** Nothing under `/api/auth`, `/api/admin`, `/api/ai/stats` or
  `/api/export` may be stored by a browser or a proxy any more, and uploaded
  files are `private` rather than `public`. Those four prefixes carry
  responses that differ per caller, and an upload belongs to exactly one
  account, so a shared cache holding one could hand it to whoever asked for
  that URL next. Known issue S-03.
- **Extra F6.** "Load older activity" on the AI usage feed adds a page instead
  of replacing the one on screen. Reading the feed used to mean losing the
  rows you had just read, with no way back. Known issue B-02, where the
  blocker was the design decision rather than the code.
- **Extra S6.** The daily sweep checkpoints the write-ahead log. The database
  runs in WAL mode and nothing in the codebase had ever called a checkpoint:
  SQLite runs one by itself past a thousand pages, but only when no reader is
  looking at an older version of the database, so a dedupe scan or a full
  export holds every checkpoint off for as long as it runs and the log grows
  for the whole time. The sweep now runs a passive checkpoint always, and a
  truncating one when the log is over 64 MB and no scan is running, because a
  truncating checkpoint behind a scan would hold the write lock until the scan
  finished. Requests refused with a database-busy error are counted, which is
  the symptom people report and the one nobody could previously measure.
- **Extra S5.** Every backup is opened again as soon as it is written. The
  service produced a snapshot, rotated the old ones, and trusted all of it,
  so the first person to find out whether any of it worked would have been
  somebody restoring after losing the original. Each snapshot is now opened
  read only, put through `PRAGMA quick_check`, and counted against the live
  database, and the answer is recorded beside the file and shown as a badge
  per snapshot in Administration. A snapshot that reads perfectly and holds
  nothing fails the check, which is the failure an integrity check alone
  cannot see. `GET` and `POST /api/backups` carry the result. At boot the
  server warns when the newest verified snapshot is older than two intervals.
- **Themes.** A dark palette, a three-way setting, and an accent colour. The
  app had one light palette of `--color-*` tokens and no `color-scheme` rule at
  all, so a dark machine got a white page with dark scrollbars. Light, Dark and
  System are in Settings, System is the default and costs no JavaScript — the
  stylesheet answers `prefers-color-scheme` on its own — and the choice is
  stored on the account, so it follows a person to their phone. The accent
  picker derives the primary and container tokens from any colour: hue and
  chroma are kept and lightness is searched until the result clears WCAG AA on
  every surface it lands on, in both palettes, which is checked over 6,000
  colours in `tests/unit/theme.contrast.test.ts`. The map swaps to a dark
  basemap, the monogram avatar carries its own `prefers-color-scheme` rule so a
  served image follows the palette, and the eight per-contact vibe colours are
  derived the same way the accent is instead of being eight hand-written light
  values.
- **Server-side preferences.** List density, the recent-contacts limit, the
  auto-merge sensitivity, the temperature unit, the theme and the accent, and
  the search history, all live in `user_settings` behind
  `GET` and `PATCH /api/auth/preferences`. They were `localStorage` keys, which
  is per browser rather than per account: a preference set on a laptop never
  reached a phone, and two people signing in and out of one browser shared
  every value including the search history. Whatever a browser still holds is
  moved to the account once and then removed, and a key the account has already
  chosen on another device is left alone. Neither route needs a session, so an
  instance with sign-in switched off can still choose a theme.
- **vCard export.** `GET /api/export/vcard` writes the caller's contacts as a
  vCard 3.0 file, and Settings offers it beside the CSV and JSON exports, which
  had no link anywhere in the app. The same `shared/vcard.ts` writes the file
  and parses one dropped on the import modal, so a round trip is lossless
  rather than nearly: `tests/unit/vcard.test.ts` walks contacts out and back in
  and compares every field, including a semicolon in a surname, a comma in a
  company, a newline in a note, an emoji across a fold, and a name long enough
  to fold four times.
- **Story 8.** A dedupe precision and recall gate.
  `tests/eval/dedupe.eval.test.ts` runs four routes over a corpus of 745
  contacts with 332 labelled pairs and compares precision, recall, F1, mean
  confidence, recall per duplicate kind and hard negatives matched per kind
  with a committed baseline. The unit tests covered the matchers one at a
  time, so a change to blocking, to a threshold or to the order the passes ran
  in could move which pairs came out and nothing would notice. The fixture
  carries twelve kinds of duplicate and seven kinds of near miss, including a
  father and a son at one firm and a couple sharing a landline, and
  `validateCorpus` refuses a corpus whose labels are not the whole truth.
  Re-record with `npm run eval:record:dedupe`.
- **Story 7.** A name in a timeline note is resolved against the contacts the
  account already has, in tiers: the normalized name, then the nickname table,
  then the phonetic hash, then a fuzzy comparison, with the company and a
  person the contact has shared a note with as tiebreakers. It used to be an
  exact string match, which missed "Jon" for "Jonathan Smith" and made a
  second ghost every time. Above a confidence threshold the mention attaches
  to the contact; below it, and above a lower one, the ghost is made and a
  suggestion pairs it with the candidate in the same review queue as a
  duplicate; below both it is a plain ghost as before. Two contacts that score
  the same demote the answer to review however high the top score is, because
  linking one of them would be a coin flip nothing on screen would show.
- **Extra S2.** A search quality gate. `tests/eval/search.eval.test.ts` runs
  fifty golden queries against a fixed corpus of three hundred contacts and
  compares recall at ten and mean reciprocal rank with a committed baseline,
  for the quick search box, for keyword ranking on its own, and for the hybrid
  fusion. Ranking could be changed by one number in one string before this,
  and nothing in the suite would have noticed. The gate fails on an
  improvement as well as on a regression, so a ranking change arrives with the
  measurement that justifies it. The contact and query embeddings are recorded
  by `npm run eval:record`, so the gate needs no model and no network.

### Fixed

- **Make merge undo restore the actual records.** Merges now record complete
  pre-merge snapshots of both primary and duplicate contacts, list memberships,
  and 12 child tables in `dedupe_merge_log.duplicateSnapshot`. Manual merges now
  soft-merge with full snapshot tracking and are completely undoable rather than
  permanently deleting the duplicate. Undoing a merge reverses unchanged child
  record transfers back to the duplicate, preserves post-merge edits on the
  survivor while restoring the original records to the duplicate, and recomputes
  follow-up task caches (`nextFollowUpAt`) on both contacts. Conflicts (such as
  post-merge task completions or field modifications) are tracked and surfaced.
  Conflicting field values are also previewed before merge confirmation across
  the dedupe review view, swipe card, and contact detail duplicate banner.
- Ask Contrack runs the same question again. The page refused a question
  that matched the previous one, and Clear did not reset that memory, so a
  question once asked could not be asked again until a different one had been
  asked in between. The guard now reads the question the search is answering,
  and only refuses a duplicate while that answer is still streaming. A Retry
  button sits in the error state and a Refresh button beside the results, and
  both re-ask the question the results belong to rather than whatever the
  input says by now.
- The synthesis brief summarises the question that was asked. The results
  carry their question as `query`, stamped by `useSemanticSearch`, and the
  brief reads it there. Before this the bar was handed the editable input, so
  typing question B over question A's results and pressing Synthesize
  summarised A's contacts under B's words. The command palette had the same
  wiring and is fixed the same way, and the `?q=` link from the palette now
  records its question, so leaving the page and coming back restores it.
- One merge policy, on every path that merges. The import path scored a
  shared phone number 0.99 where a scan scored it 0.95, scored an exact name
  across two sources 0.95 where a scan scored it 0.92, and ran at a fixed
  0.93 whatever sensitivity the account had chosen. `dedupe/policy.ts` now
  holds the one table of confidences and the one preset table, and the scan,
  the import, and the check after a contact is added all read the account's
  preset from it. The browser sends the scan mode and nothing else.
  `POST /api/dedupe/scan` still accepts `autoMergeThreshold` as an override
  for one scan.
- A shared identifier is weaker evidence when many contacts carry it, and no
  evidence of one person when the names disagree. Each contact beyond the pair
  costs a match three points, so a phone number on three contacts asks under
  the balanced preset. A shared number or address between two different first
  names, or between "Sr." and "Jr.", is capped at 0.85, below every preset,
  and reaches the review queue with the reason written on it. On the eval
  corpus the pairs a scan would merge that are two different people fell from
  30 to 14, and the import path's from 47 to 14, with the scan losing one
  correct merge to review and the import path none that a scan would have
  made.
- The interaction composer keeps a note until the save that keeps it. It
  cleared its editor the moment a save started, on the button and on
  Mod-Enter alike, so a request that failed took the note with it. On
  success only the submitted content is removed, and a sentence finished
  while the request was out stays in the editor. A second Save while one is
  pending starts no second request. What is in the composer is written to a
  draft in `localStorage` a moment after each keystroke and flushed when the
  page is hidden, unloaded, or the composer leaves the tree, so a session
  that expires mid-save, or a navigation away, does not lose the note. Drafts
  are keyed by account and by contact, so two people in one browser never
  open each other's. Mod-Enter also sent a "note" with no follow-up whatever
  the screen showed, because the shortcut kept the first render's closures.
  It sends what is there now.
- A merge keeps the duplicate's follow-up tasks. `action_items` was the one
  child table the merge never re-parented, so the hard merge's final `DELETE`
  took every task the duplicate carried through `ON DELETE CASCADE`, and a
  soft merge left them on a contact the list no longer shows. Both paths now
  move every task, completed ones included, inside the merge transaction, and
  recompute `nextFollowUpAt` on the survivor and on the duplicate. The
  `action_items_sync_update` trigger also settles the contact a task moved
  away from, which it did not before.
- **Story 10.** The hourly relationship-score sweep recomputes only what
  changed. It scored every contact of every account every hour — 989 ms on
  50,000 contacts to change almost nothing — and now reads a partial index of
  contacts a trigger has marked, which is 0.08 ms on a quiet instance and 1.79
  ms after ten new interactions. A daily full pass still runs, because recency
  decays with the clock and no trigger can see that; it is 435 ms on the same
  50,000 contacts, down from 989 ms, because the per-contact statement is now
  prepared once rather than per contact. Both sweeps take turns between
  accounts a batch at a time, so a large account cannot put a small one behind
  it.
- **Story 10.** Writing a relationship score is no longer an edit. The sweep
  wrote `relationshipScore` on every contact every hour, which fired the
  `contacts_auto_updated_at` trigger and stamped `updatedAt` across the whole
  instance. `updatedAt` therefore meant "the last sweep" rather than "when this
  contact was last edited", and `findStaleEmbeddings` re-embedded every contact
  in the account on the next dedupe scan, through whichever provider is
  configured. Both `updatedAt` triggers now name their columns, and the list is
  derived from the table so a column added later is covered.
- **Themes.** Two placeholder prompts on the contact detail page are readable.
  "Add Birthday..." and "Add Industry..." were drawn at half opacity, which is
  half the contrast: 2.19:1 and 2.86:1 on a white card. They are italic and
  muted now instead. Found by the contrast audit on the first run that reached
  the contact detail route, which needs an instance with contacts in it.
- **vCard import.** The vCard parser unfolds long lines, decodes
  quoted-printable, and understands both spellings of a parameter. It was a set
  of regular expressions over raw lines, so a name longer than 75 characters
  arrived cut in half, `TEL;WORK;VOICE:` from a phone arrived with no label,
  and an address book exported from an older Android or Outlook rendered
  "José" as "JosÃ©". A `CELL`, an `IPHONE` and a `MOBILE` are now one label
  rather than three.
- **Story 1.** The embedding model runs on a `worker_threads` thread instead
  of the request thread. A backfill of 2,000 contacts took 2.4 seconds and
  blocked the event loop for 2.19 of them, in bursts of up to 83 ms, so while
  one account's index was built every other account's requests waited. The
  same backfill now blocks it for 0.03 seconds with a worst single stall of 7
  ms. The worker has no database connection and no way to get one, so the
  single-writer rule holds by construction. A worker that will not spawn falls
  back to running in process, and `DISABLE_CPU_WORKER=true` selects that
  deliberately.
- **Story 1.** The deterministic dedupe pass no longer joins contacts to
  contacts through a function. It matched on
  `LOWER(TRIM(name)) = LOWER(TRIM(name))`, which no index can answer, so
  SQLite compared every contact with every other: 42.9 seconds on 10,000
  contacts to find no duplicates at all, and the cost grew with the size of
  the account rather than with the number of duplicates in it. The email pass
  had the same shape. Both group rows that are already loaded, which is 24 ms
  at 10,000 contacts and 131 ms at 50,000.
- **Story 1.** The scoring pass no longer asks the vector store for a
  similarity when there is no vector store. Every one of those queries failed
  inside its own try/catch and returned zero, so 30,000 candidate pairs meant
  30,000 failing queries: 1.16 seconds of a 1.2-second pass.
- **Story 1.** `normalizeCompany` compiles its thirty-three suffix patterns
  once instead of on every call. It was the most expensive thing in the dedupe
  normalizer and in mention resolution: 339 ms to 69 ms per 50,000 calls.
- **Story 4.** The vector search filters inside the index rather than around
  it. Both `vec0` tables carry the contact's ghost, archived and active state
  as sqlite-vec metadata columns, so the nearest neighbours are chosen from
  contacts somebody can see rather than filtered afterwards. It replaced a
  subquery that made SQLite list every active contact in the account on every
  search: 43.68 ms to 1.48 ms per query on 50,000 contacts, 8.16 ms to 0.36 ms
  on 10,000, for the same fifty contacts in the same order. A trigger keeps
  the columns equal to the contact row. The dedupe neighbour search applies
  the same predicate, so it no longer spends a neighbour slot on an archived
  or trashed contact the scorer would drop.
- **Story 4.** Archiving a contact no longer deletes its search vector. The
  vector encodes the contact's text, which a status change does not touch, so
  archiving and restoring somebody used to cost an embedding for nothing.
- **Story 7.** The name tokenizer folds accents onto the base letter.
  "María García" tokenized to four fragments with a surname of "a", because
  every accented character was treated as punctuation and replaced with a
  space. Every consumer improves: the dedupe eval's diacritic recall went from
  0.9375 to 1.0 with precision up and nothing else moved.
- **Story 7.** A ghost never survives a merge with a real contact.
  `computePrimaryScore` counted fields and nothing else, so a bare real
  contact and a ghost both scored 5 and the survivor came down to which id
  sorted first.
- **Extra S3.** A bulk import checks its contacts for duplicates in one pass
  instead of one pass each. Every check normalized the whole account and built
  a whole scan context of its own, so importing `n` contacts into a corpus of
  `m` did about `n × m` work and nearly all of it was the same work repeated.
  Measured: a thousand contacts into a corpus of ten thousand went from 113
  seconds to 1.8 seconds, and the gap widens as the corpus grows. The
  streaming import used its own separate matching, written out in the route
  and weaker than the other path's, so what counted as a duplicate depended on
  whether the client asked for a stream. Both paths now run the same scan, and
  a streaming import finds nicknames and close profiles it could not see
  before. One behaviour changed with it: an imported contact whose name
  already exists is now a suggestion to review rather than an automatic merge.
  The streaming import scored that at 0.95 and merged it, the other import
  scored it at 0.92 and asked, and two people can share a name.
- **Phase 3.** An expired personal token is refused from the moment it
  expires. The expiry check compared a database timestamp against a
  JavaScript one, and a space sorts before a `T`, so a token whose expiry fell
  earlier on the same UTC day still worked, in the worst case for nearly a
  full day past the time it was meant to stop.
- **Phase 3.** A capital letter no longer escapes the AI rate limits. This
  app routes URLs case-insensitively, so `/API/Dashboard/Insight` reaches the
  same handler and makes the same billable call as the lower-case spelling,
  and neither limiter was counting it.
- **Phase 3.** The daily sweep removes a session or an invitation that expired
  earlier the same day, rather than leaving it for the next day's run, and a
  session that has expired no longer counts towards the session totals an
  account or an administrator sees.
- **Phase 3.** A personal token's `lastUsedAt` is stamped at most once an
  hour, as it was always meant to be. The hourly check compared a database
  timestamp (`2026-09-10 05:33:50`) against a JavaScript one
  (`2026-09-10T04:33:50.000Z`), and a space sorts before a `T`, so the stored
  value looked older than any cut-off from the same day and the row was
  written on every request a script made.
- **Phase 3.** An invitation link no longer reaches the access log. The link
  carries its secret in a query string, and the invitee's browser sends it to
  this server as an ordinary page request, so the one value the invitation
  system keeps out of the database was landing in the request log instead.
  The value of `token`, `secret` and `api_key` is replaced in every logged
  URL.

- **Phase 4.** An administrator could reset their own password and be locked
  out of the instance. A reset deletes every session of its target, so aiming
  it at yourself signs you out mid-request and the response carrying the new
  password reaches a browser that is already being torn down. The old password
  no longer works either. `POST /api/admin/users/:id/reset-password` now
  refuses a self-target, alongside the disable and the delete it already
  refused.
- **Phase 4.** The account row menu was clipped away by the list's
  `overflow-hidden`, so on the lower rows Disable, Delete and Export were
  painted outside the box and could not be clicked at all.
- **Phase 4.** A failed read in the administration area rendered as "there is
  nothing here". A query that fails leaves its loading flag false and its data
  undefined, so a 500 or a dropped connection reported an empty instance in
  reassuring copy, and the Instance page painted its controls from invented
  defaults including registration "closed".
- **Phase 4.** The Settings back button was a 36 px touch target, on the one
  control every page in that area shares. The AI usage empty state was drawn
  at 1.57:1 contrast, the only text in the app the audit fails on.
- **Phase 4.** `npm run audit:contrast` could not gate anything it was pointed
  at. Its default port was one nothing listens on, its route list named none
  of the administration pages, and it drives a browser with no session — so on
  a gated instance it measured the sign-in screen a dozen times and reported
  zero failures. It now defaults to the port `npm run dev` serves, sweeps the
  administration area, and says in the file that it has to run against an
  instance with sign-in off.

- **Phase 4.** Enrichment reported every refusal as the daily grounding quota
  being exhausted. The branch that did it could not run at all — the shared
  client throws for any non-2xx, so the code reading `res.status` was
  unreachable — and since Phase 3 the likeliest refusal is the per-account AI
  limit, not the quota. The message now comes from the code the server sent,
  and a limit held by another account says so instead of blaming the reader.
- **Phase 4.** A dedupe stream that failed four times used to stop silently:
  no error, no toast, no change on screen, and a progress bar that never moved
  again for a scan that finished normally. An `EventSource` failure carries no
  status, so the client now asks `/api/auth/status` which kind of failure it
  was. A signed-out browser goes to the gate; a working one falls back to
  polling the scan until it ends.
- **Phase 4.** The contacts prefetch ran at module load, before React
  rendered, so the first request of every page load on a gated instance was a
  `401` from a browser that had not yet asked whether it was signed in. It now
  runs when the gate opens, and again for the next account after a sign-out.
- **Phase 4.** Three components reached `/api/...` with a bare `fetch`: the
  bulk import, the link unfurler, and the enrichment call. None of them could
  act on a `401` or a `403`, so a session that expired during an import
  produced a failed import and no way to sign back in.
  `tests/unit/frontend.apiClient.test.ts` scans the source and fails on the
  next one.

### Removed

- **Extra F5.** The environment variable `AUTH_TOKEN`. It was the name
  `API_TOKEN` had before accounts existed, and 1.x went on honouring it with a
  warning at every boot. **The server now refuses to start while it is set**
  rather than starting with no credential at all: an operator who believes
  their instance is protected is the worst of the three possible outcomes.
  Rename it to `API_TOKEN`, which is itself deprecated and goes away in 3.0.

### Changed

- `GET /api/interactions/search`, the MCP note search, runs on the note index.
  It matched `q` as a substring of the title or body and returned raw rows; it
  now matches by word and stem, reads date phrases, accepts the same filters
  as `GET /api/search/interactions`, answers with a plain-text `excerpt` in
  place of the HTML `content`, and hides notes on contacts the app hides. The
  response is still an array, and each hit still carries `title` and
  `contactName`.
- **Extra F2.** CI enforces a coverage floor instead of only reporting one.
  `vitest.config.ts` carries thresholds set two points under what was measured
  when they landed, with a second, independent floor on `server/**`. The
  matrix and manifest tests are what hold the isolation guarantee up, and
  before this a pull request could delete them and go green.
- **Phase 4.** Session length moved from Account settings to Administration →
  Instance. It decides how long every account's sign-in lasts, which stopped
  being a personal setting the moment an instance could have more than one
  account. `/settings/ai-config` redirects for the same reason: one set of
  provider keys pays one bill.
- **Phase 4.** `GET /api/dedupe/active` reports `queued`. A booked scan is a
  real record with phase `starting`, identical to a scan that began a moment
  ago, and this is the only thing that tells them apart after a reload.
- **Phase 4.** `GET /api/admin/audit` takes an `action` filter, validated
  against the actions the app writes. Filtering a fetched page would show two
  sign-ins out of fifty rows with no way to reach the rest, and an audit log
  that answers a typo with an empty page reads as "nothing happened".

- **Phase 4.** Signing in as a different account replaces the whole component
  tree rather than reusing it. Clearing the query cache removed what the
  server had sent; the recently-viewed list, the last AI Search, the dedupe
  scan and every open panel were React state and survived it.
- **Phase 4.** `emitAuthExpired` carries a reason. A `401` and a
  `403 ACCOUNT_DISABLED` both end at the sign-in screen and now say different
  things there, because inviting somebody whose account an administrator
  closed to try their password again sends them round a loop with no end.
- **Phase 4.** `.agent/STYLE.md` states the two mobile rules the primitives
  have carried without documenting: a 44 px minimum hit area on every touch
  control, and modals as bottom sheets below `sm`.
- **Phase 3.** The fourteen routes the route manifest has classed `admin`
  since Phase 2 are now closed to a member. Backups, every write under
  `/api/settings/ai`, the AI diagnostics and grounding-capacity reports, the
  instance-wide embedding backfill, the session-policy write and the
  development cache-stats endpoint each answer `403 ADMIN_REQUIRED`. The guard
  sits on each route rather than on its router, and the manifest test fails
  when an admin route arrives without it.
- **Phase 3.** Deleting an account is two steps. The first answers
  `409 USER_HAS_DATA` with what the account owns and changes nothing, so the
  export button next to the delete button is still useful. A request that says
  `decision: "purge"` removes every row, both vector stores, the embedding
  metadata, the search index rows and the upload directory, in one
  transaction. Ten thousand contacts take 147 ms.
- **Phase 3.** Three guards stand between an administrator and an instance
  nobody can administer. The last active admin cannot be demoted, disabled or
  deleted. An admin cannot disable or delete their own account. The local
  account that owns this device's data cannot be touched while authentication
  is off, because nobody can sign in as it.
- **Phase 3.** The forced password change covers `PUT /api/auth/session-policy`
  as well. That route sets how long every future session on the instance
  lasts, and it lives in the auth router, which the gate exempts so that a
  password change stays reachable. The exemption is now the six paths an
  account with a temporary password actually needs.
- **Phase 3.** `GET /api/auth/status` reports `registrationOpen`,
  `localOwnerPresent` and `legacyTokenConfigured`, and `GET /api/auth/me`
  reports `via`. The environment `API_TOKEN` still works, still acts as the
  first admin, and now logs one deprecation warning at startup. It is removed
  in 3.0, and a personal token replaces it.
- **Phase 3.** Disabling an account ends its sessions at once and refuses its
  personal tokens while it is off. Enabling gives the tokens back. The
  sessions stay gone, because revoking one is a delete rather than a flag.
  Resetting a password revokes both.

- **Phase 2.** Every route that reads or writes owned data now filters by the
  account that asked, and the isolation matrix proves it for all eighty of
  them. A route that carries no test in that file fails the manifest check, so
  a new one cannot arrive unproven.
- **Phase 2g.** A data export contains the account's own rows, in every table
  it returns. Contacts, interactions, lists, list memberships, action items
  and the merge history each stop at the caller. One request used to return
  every account's data on the instance, which made the export the widest read
  in the app by a wide margin.
- **Phase 2g.** An export filename names the account it came from, as
  `contrack-export-<username>-<date>.json` and
  `contrack-contacts-<username>-<date>.csv`. Two people exporting on the same
  day used to download two files with the same name, and the second one
  replaced the first.
- **Phase 2g.** The trash is per account. Restore and purge answer `404` for
  a contact another account deleted, with the same body an id that never
  existed answers. The trash list holds the caller's own deleted contacts and
  nobody else's, and a mixed bulk restore brings back only the caller's rows
  and counts only those, keeping the `200` it has always answered because
  undo is forgiving by design.
- **Phase 2g.** The MCP surface answers for the account that asked. The
  contact query, the follow-up list, the tag and industry vocabularies, the
  interaction search and the whole-account timeline each read one account's
  rows. A personal API token acts as its own account here, exactly as a
  browser session does, so an MCP client reads the contacts of whoever issued
  its token and nobody else.
- **Phase 2h.** Both embedding backfills run one account at a time, inside
  that account's context, and accounts take turns in rounds of 200 contacts.
  A large account no longer holds up a small account's first results, and a
  provider call made from inside a backfill now names the account whose
  contacts it embedded rather than the instance's first administrator. No
  invocation row is written for an embedding yet, so nothing appears in the
  AI stats feed either way, but every path that reads the caller from the
  context gets the right answer.
- **Phase 2i.** `npm run lint` runs `tenant-lint --strict` over the whole of
  `server/`. Every SQL statement that reads an owned table either names the
  owner or carries a one-line reason why it does not.
- **Phase 2i.** The four single-column owner indexes are dropped on the next
  boot, as tenancy schema version 2. Each was the leading column of a
  composite index that answers the same query, so each cost a second B-tree
  write on every insert and gave the query planner a narrower index to prefer
  over the one the reads were built for.

- **Phase 2e.** A duplicate scan reads one account's contacts and finds one
  account's duplicates. Every stage is scoped: the normalized corpus, the five
  child-table loads behind it, the exact email, phone and name passes, the
  embedding neighbours, the co-occurrence and exclusion constraints, and the
  clusters the scan reports. Two people who share a name across two accounts
  are two people, and the scan can no longer suggest merging them into one.
- **Phase 2e.** Every merge checks that both contacts belong to the caller,
  in one statement, before it moves a single child row. A merge that names a
  contact the caller does not own answers `404`, with the same body an id that
  never existed answers, and nothing moves.
- **Phase 2e.** Suggestions, dismissals, exclusions and the merge log are per
  account. The review queue, the sidebar badge, the per-contact banner and the
  merge history each showed every account's rows. Undoing a merge works on the
  caller's own audit entries only.
- **Phase 2e.** A scan status page and its live stream answer `404` for a scan
  another account started. A scan record holds every cluster it found with the
  contacts hydrated inside it, so an id that leaked used to be a complete read
  of somebody else's duplicate list.
- **Phase 2e.** A full-mode scan clears its own account's dedupe vectors. It
  ran an unqualified delete before, so one person choosing "full" erased every
  other account's dedupe index and made their next scan pay a provider to
  rebuild it. Re-embedding changed contacts on a deep scan is scoped the same
  way, and the embedding coverage figure now describes the caller's own
  contacts rather than the instance.
- **Phase 2e.** One scan still runs at a time for the whole instance, and an
  account that arrives while the lock is held takes its turn instead of being
  turned away. Its scan starts on its own when the running one finishes.
- **Phase 2e.** **Breaking:** starting a scan while one is already running
  answers with the standard error envelope, `{ error: { code, message,
requestId, details } }` with code `RATE_LIMITED`, instead of a bare
  `{ error: "<message>" }`. `details.yours` says whether the caller is already
  scanning or somebody else holds the lock, and `details.queued` says whether
  a turn was booked. Any client reading `error` as a string must read
  `error.message` instead.
- **Phase 2f.** AI research batches belong to the account that started them.
  Polling a batch, opening its live stream, or cancelling it works for its own
  account and answers `404` for everybody else, with the same body an id that
  never existed answers. A batch refuses a contact the caller does not own
  before it spends a single token.
- **Phase 2f.** The five-minute research cooldown is per account. One person
  finishing a batch used to make everybody else on the instance wait. The
  single-batch run lock stays instance-wide, because the provider API key it
  protects is shared.
- **Phase 2f.** Starting a batch too soon now answers with the same error
  shape as every other endpoint, including a request id, and says whether the
  refusal is the caller's own cooldown or somebody else's batch holding the
  shared lock. It was the one endpoint that answered with a bare message.
- **Phase 2f.** The AI stats page counts the caller's own invocations, tokens
  and cost. It described every account's AI use before. The shared in-process
  cache counters stay, for an admin only, because they describe the instance
  rather than a person.
- **Phase 2f.** Editing a contact clears that account's cached AI work and
  leaves everybody else's alone. Every affected cache is keyed by account now,
  so one person adding a contact no longer costs every other account a fresh
  search, briefing and daily insight through a paid provider.

- **Phase 2c.** Search returns the caller's own contacts and nobody else's, in
  every channel. Keyword search, the semantic pipeline and its NDJSON stream,
  the executive brief, the hard filters behind a parsed query, and the trait
  boosts all read one account's rows. The keyword index carries an owner token
  and intersects it inside the index, so another account's contacts are never
  read and then dropped.
- **Phase 2c.** Vector search asks one account's partition. The nearest
  neighbour query fetched the instance-wide top hundred and filtered the
  result afterwards, so an account with a few hundred contacts on a large
  instance rarely appeared in that hundred and their vector channel returned
  nothing. This is a correctness fix before it is a speed one. The three
  duplicate-detection vector queries take the same predicate.
- **Phase 2c.** Cached search results are held per account. Reranked matches
  and the executive brief were cached under the query text alone, so the first
  account to search a phrase had its own contacts served to every other
  account that typed the same words for the next twelve hours.
- **Phase 2c.** The executive brief refuses a contact id the caller does not
  own with the same answer a deleted id has always taken.

- **Phase 2b.** Interactions, action items, and lists belong to the account
  that created them. Every timeline, briefing, attachment, follow-up task, and
  list endpoint reads and writes the caller's rows only. Another account's id
  answers `404` with the same body an id that never existed answers.
- **Phase 2b.** A note that mentions somebody now stays inside the writer's
  own contacts. Two paths handle mentions and both were open: the AI extractor
  matched a name against every contact on the instance, so a note could link to
  a stranger's row instead of creating a ghost, and the editor's own mention
  markup was inserted with no check at all, so any contact id in the request
  body was linked. The extractor matches the caller's contacts and creates a
  ghost the caller owns. The markup path drops any id the caller does not own.
- **Phase 2b.** Each account's lists number from zero. `sortOrder` came from
  the highest number on the instance, so a new account's first list started
  above every list stored on that box.
- **Phase 2b.** Removing a contact from a list and adding contacts in bulk now
  check both the list and the contact. Removing checked nothing at all, and
  bulk adding checked only the list. Reordering answers `404` when the request
  names a list the caller does not own, and keeps its `400` for a set of the
  caller's own lists that is not complete.
- **Phase 2d.** The dashboard, the daily insight, and the command palette
  zero-state count the caller's own contacts, interactions, follow-ups, and
  duplicate suggestions. Every number on those three screens described the
  whole instance before.
- **Phase 2d.** The daily insight is cached per account. One account's
  AI-written paragraph about their own network was cached under a key that
  described the instance, so whoever opened the dashboard first had their
  insight served to every other account for 24 hours. The cache now holds one
  entry per account.

- **Phase 2a.** Contacts belong to the account that created them. Every
  contact endpoint reads and writes the caller's rows only: the list, the map,
  the archive, the trash, one contact by id, the score breakdown, both bulk
  endpoints, avatar upload, and enrichment. Another account's id answers `404`
  with the same body an id that never existed answers, so the response cannot
  be used to find out which contacts exist. A bulk request that names another
  account's ids reports the number of the caller's own rows it changed.
- **Phase 2a.** Import-time duplicate matching stops at the importer's own
  contacts. Importing a file that happens to contain a name or an email
  another account already has no longer matches, merges, or files a
  suggestion against that account's contact.
- **Phase 2a.** Uploads are served to their owner only. A request for
  `/uploads/u/<ownerId>/...` answers `404` unless the caller is that owner.
  `/uploads/logos/` stays shared, and every other `/uploads` path answers
  `404`. The check is a comparison against the path, with no database read.

- **Phase 1, breaking.** Endpoints that manage the signed-in account refuse an
  API token with `403 SESSION_REQUIRED`. The code was `403 USER_REQUIRED`. The
  seven affected endpoints are under `/api/auth`: `GET /me`, `PATCH /me`,
  `POST /change-password`, `GET /sessions`, `DELETE /sessions`,
  `GET /session-policy`, `PUT /session-policy`. Nothing else changes, and a
  token still reaches every data endpoint. The rename is because every request
  now carries a user account, so "user required" said the opposite of what the
  gate checks: it wants a browser session, not merely a valid credential.
- **Phase 1.** Auth-off instances now have an account. Every instance gets a
  `local` account at boot that nobody can sign in to, and it owns this
  device's data. `GET /api/auth/status` reports it, so an ungated instance
  answers `authenticated: true` with a user instead of `null`. Securing the
  instance converts that account rather than creating a second one, so
  everything it already owns stays owned and nothing has to be claimed.
- **Phase 1.** Uploads live under `uploads/u/<ownerId>/avatars/` and
  `uploads/u/<ownerId>/files/`. Existing files move on the first boot and the
  stored URLs are rewritten to match. `uploads/logos/` stays shared. A file no
  row references moves to `uploads/orphaned/` and is logged. Nothing is
  deleted. The old flat URL now returns `404` for a file that moved.
- **Phase 1.** `GET /api/auth/status` reports `deviceContacts`, which is what
  `existingContacts` counted. Both names are sent for now so an older frontend
  keeps working; `existingContacts` goes away in Phase 3.
- **Phase 1.** Signing in to a disabled account returns `403 ACCOUNT_DISABLED`
  rather than succeeding. The check runs after the password, so a wrong
  password still gets the shared `401 INVALID_CREDENTIALS` and this cannot be
  used to find out which accounts exist. Disabling an account also ends its
  live sessions on their next request.
- **Phase 1.** Auth-off mode is refused when real accounts exist. The server
  logs an error at boot and enforces auth anyway, because with a second
  account there is no answer to "who is the caller with no credential".

- **Phase 0.** CI now runs for the `v2.0` integration branch. Pull requests
  into `v2.0`, and pushes to it, run the `build-and-test` job. The container
  image job and the release job still run only for `main` and for version
  tags, so `v2.0` publishes nothing.

### Added

- **Phase 1.** Every row in every owned table has an owner, enforced by
  triggers rather than by convention. Eight tables carry `ownerId` now:
  `contacts`, `lists`, `interactions`, `action_items`, `dedupe_suggestions`,
  `dedupe_exclusions`, `dedupe_merge_log` and `ai_invocations`. An insert with
  no owner is refused on the four that have no parent contact, and filled from
  the contact on the four that do. A child row whose owner disagrees with its
  contact is refused, which is what makes a cross-owner duplicate suggestion
  impossible rather than merely unlikely.
- **Phase 1.** The upgrade takes a full copy of the database first, with
  `VACUUM INTO`, into `backups/pre-tenancy-<stamp>.db`. The copy is made before
  any schema change, so restoring it puts the instance exactly back. It is
  skipped with an error in the log when free space is under 1.5 times the
  database size, rather than failing the boot. `backupService` never rotates
  it away, so delete it by hand once the upgrade is trusted.
- **Phase 1.** `npm run tenancy:verify` checks an upgraded instance: no
  unowned rows, every child owner matching its contact, the search index
  complete and correctly tokenized, both vector stores partitioned with no
  orphans, no uploads left at the old paths, and all 27 triggers present.
- **Phase 1.** `scripts/tenancy-rollback-uploads.mjs` moves uploads back to
  the 1.x layout, for a downgrade after restoring the backup.
- **Phase 1.** Vector search is partitioned by owner. Both `vec0` tables gain
  `ownerId TEXT PARTITION KEY`, and existing vectors are copied into the new
  shape rather than recomputed, so upgrading spends nothing with an embedding
  provider. The boot refuses to start on a sqlite-vec below 0.1.6, which is
  where partition keys were introduced.
- **Phase 1.** Per-user API tokens (`ctk_...`) are recognized. Only the
  SHA-256 is stored. A revoked token, an expired one, and one belonging to a
  disabled account are all refused. Phase 3 adds the endpoints that create
  them.

- **Phase 0.** New rows carry their owner. On an instance with
  `AUTH_REQUIRED=true`, a contact, a bulk import, a list, a ghost contact from
  an `@mention`, an AI invocation and a merge log row are all stamped with the
  signed-in user's id as they are written. This starts working without a
  restart. Anonymous instances still write no owner and are unaffected.
- **Phase 0.** A benchmark script, `scripts/bench-tenancy.ts`, to measure
  query and mutation latency under multi-tenant scoping.
- **Phase 0.** A route manifest at `server/tenancy/routeManifest.ts` names
  every route and what guards it. A test compares it against the routes the
  app really registers, so a new route cannot ship unclassified. The route
  list is recorded while the app builds, because Express 5 keeps no mount
  path strings.
- **Phase 0.** `scripts/tenant-lint.mjs` reports SQL over owned tables that
  carries no owner predicate. `npm run lint` runs it in strict mode
  to ensure all queries touching owned tables carry an owner predicate.
- **Phase 0.** The request context, `server/tenancy/scope.ts` and
  `server/tenancy/requestContext.ts`. A request now carries who is asking
  through the async call tree, which later phases use to stamp ownership.
  Nothing reads it on the data path yet, so behavior is unchanged.
- **Phase 0.** A unit test pins the BM25 weighting rule. `bm25()` reads its
  weights by column position and counts `UNINDEXED` columns, so
  `contacts_fts` needs one weight per column and `contactId` needs a zero.
  Search ranking does not change, because the offset this guards against was
  already corrected in 1.5.5. Phase 1 adds two more columns to that table,
  and this test fails if the weight list is not extended with them.

### Fixed

- **Phase 2g.** The MCP contact query no longer answers with rows the app
  hides. It had no trash filter, no ghost filter and no merged-away filter, so
  an MCP client saw people the user had thrown away, the placeholder rows a
  mention creates, and the losing side of every merge. An agent acting on a
  merged id wrote an interaction onto a record the app never shows again.

- **Phase 2h.** A duplicate scan embeds its own account's contacts. It called
  the instance-wide backfill in the middle of a scan, so one person pressing
  "scan" paid a provider to embed every other account's contacts, and a
  full-mode scan that had just cleared its own vectors refilled everybody's.

- **Phase 2i.** `tenant-lint --strict "server/**/*.ts"` covers files that sit
  directly in `server/`. `**` matched one or more directories, so
  `server/db.ts` fell outside every strict glob used, and the
  fourteen boot statements in it were never checked.

- **Phase 2a.** The migration test's second-boot check no longer depends on
  the clock. It compared `updatedAt` against the fixture, which the legacy
  follow-up backfill legitimately moves on one contact during the first boot,
  so the test failed whenever the fixture build and that boot landed in
  different seconds. It now compares against the state the first boot left.

- **Phase 1.** Upgrading no longer re-embeds the whole contact list through a
  paid provider. Two bulk writes during the migration stamped `updatedAt` on
  every row they touched, and the deep dedupe scan re-embeds any contact whose
  `updatedAt` is newer than its last embedding. The ownership claim now runs
  with the seventeen affected triggers dropped, and the uploads relocation runs
  in the same window. Measured on 5,000 contacts: the claim stamped all 5,000
  before, and none after.

- **Phase 0.** `GET /api/contacts/action-items` works again. `contactsRouter`
  mounted before `mcpRouter`, so `GET /contacts/:id` captured `action-items`
  as a contact id and answered `404`. The route was unreachable, so no
  working client changes behavior. The MCP router now mounts first.

## [1.5.5] — 2026-08-09

Corrections from an independent review of the v1.5.4 release, run with fresh
context specifically to catch what the author could not see in their own
work. It caught one real regression — proven live before the fix shipped.

### Fixed

- **v1.5.4's docker-compose file silently disabled scheduled backups.** The
  new env passthrough rendered an absent `BACKUP_INTERVAL_HOURS` as an empty
  string — set, but empty — and the schedule guard's `!== undefined` check
  read that as an explicit `0`: disabled. Any Compose user upgrading through
  v1.5.4 lost the default 24-hour snapshots without a word (our own
  deployment included, which is how the finding was confirmed). Empty now
  means unset; only an explicit `0` disables. All eight forwarded variables
  were audited for the same trap — this was the only one using a presence
  check — and a regression test pins the exact empty-string shape Compose
  sends.
- **Seeding a brand-new data directory failed** with "no such table" — the
  seed scripts opened a private connection before any migration ran. They
  now use the server's own database module, which migrates on import.
  Verified: fresh empty `DATA_DIR` → first run inserts, second run skips.
- **The SSRF guard missed private addresses wrapped in IPv6.** It knew three
  hardcoded `::ffff:` prefixes; `::ffff:169.254.169.254` (cloud metadata),
  CGNAT, `172.16/12`, and NAT64 (`64:ff9b::`) wrappings all walked past it.
  The gap predates 1.5.4, but the connect-time rebinding guard added there
  leans on this function. Any IPv6 address embedding an IPv4 — dotted or
  hex-group form — is now judged by the full IPv4 policy, block and pass
  cases pinned in tests.
- The scripts table in getting-started still claimed `npm run seed` clears
  the database — the one line the docs audit missed. The table now matches
  the code and lists the scripts CI actually enforces.

## [1.5.4] — 2026-08-09

The clone-and-host release. Four independent verification passes — a clean-
clone install test, a full Docker hosting pass, an adversarial review of every
change since 1.5.3, and a docs-vs-reality audit — ran against this tree, and
everything they found is fixed here. The result: `git clone`, one command, and
a running instance, with an API key, a self-hosted OpenAI-compatible endpoint,
or no AI at all.

### Added

- **A fresh clone installs again.** `npm install` failed outright with an
  ERESOLVE peer conflict — `eslint-plugin-jsx-a11y` (at its latest, 6.10.2)
  declares peer support only through eslint 9 while the project uses
  eslint 10. The Dockerfile and CI already passed `--legacy-peer-deps`;
  humans following the README had no such luck. A committed `.npmrc` now
  makes `npm install` and `npm ci` work exactly as the docs write them.
- **A prebuilt-image quick start.** CI has published multi-arch images to
  `ghcr.io/arvarik/contrack` all along; the README finally says so, with a
  one-command `docker run` that skips the from-source build entirely.
- A "Running as a Service" section in the configuration guide: `/healthz`,
  the Docker HEALTHCHECK, SIGTERM drain semantics, the 65-second keep-alive
  and why it matters behind a proxy, and what the production CSP will block.
  The API reference now documents `/healthz`, the 1 MB body limit with its
  single 50 MB exemption, the true pre-auth surface, and fourteen endpoints
  that existed only in code.

- **The process now survives `docker stop`.** SIGTERM/SIGINT drain in-flight
  requests, close SQLite with its WAL checkpoint, and exit 0 — previously the
  process rode Docker's grace period into a SIGKILL on every stop, closing the
  database uncleanly each time. An 8-second internal deadline keeps a hung
  handler from reaching the SIGKILL anyway.
- **`/healthz` and a Docker HEALTHCHECK.** The probe lives outside the auth
  gate (a health check holds no credential), proves both the event loop and
  SQLite answer, and reports nothing else. Docker can now see a process that
  is alive but wedged; `restart: unless-stopped` only ever noticed dead ones.
- Boot failures exit non-zero with a log line naming startup;
  `unhandledRejection` logs with the stack instead of crashing bare;
  `uncaughtException` closes the database before exiting.

### Fixed

- **The seed scripts wrote to the wrong database on any `DATA_DIR` install**
  (Docker included): both hardcoded `curator.db` in the working directory
  while the server reads `$DATA_DIR/curator.db`. Seeding a Docker instance
  created a stray database the app never opens. Both scripts now resolve the
  path exactly as the server does.
- **The configuration guide told Docker users to mount the project root** as
  their persistence volume — advice that would shadow the built app and
  `node_modules` inside the image and break the container. It now says what
  `docker-compose.yml` actually does: mount `/app/data`, which holds the
  database, uploads, backups, and the embedding-model cache, and is the
  entire persistence story.
- **Seeding docs described a destructive import that never existed.**
  `npm run seed` inserts one example contact and skips a non-empty database —
  it deletes nothing, ever. The "~50 demo contacts" (actually ~30, from
  `npm run db:seed`) and the false "seeding clears the existing database"
  warning are corrected everywhere.
- **An OpenAI- or Anthropic-only install booted to a false alarm.** Startup
  validated only the key matching `AI_PROVIDER` (default `gemini`), so a
  working OpenAI-only setup was greeted with "GEMINI_API_KEY is not
  configured — AI features will fail gracefully", which was simply untrue.
  Boot now reports the providers actually configured, and with none it says
  what to do (Settings → AI) instead of implying something is broken.
- `docker-compose.yml` forwarded only eight environment variables, so a
  documented setting like `BACKUP_KEEP=30` in `.env` was silently ignored on
  the Docker path. The optional tuning variables now pass through.
- `APP_URL` was documented in two places and read by zero lines of code —
  removed from the docs and `.env.example`. `DISABLE_BACKGROUND_JOBS`,
  `NODE_ENV`, and the configurable session lifetime were the reverse (real
  behaviour, documented nowhere) and are now in the reference.
- The README's two contradictory test counts (474 in the badge, "180 tests,
  <600ms" in the table) both now reflect the real suite, and the Vite config
  no longer triggers a loader warning on every boot (`__dirname` in an ESM
  config, replaced with `import.meta.dirname`).

- **Swipe-merge stayed blocked after confirming a large cluster.** The drag
  handler captured the confirmation flag once and never saw it change — a
  stale closure the exhaustive-deps burn-down surfaced. The merge buttons
  worked; the swipe silently did not.
- The scroll-position save on unmount read a ref React had already cleared,
  so leaving a list mid-scroll saved nothing and the position restored stale.
- The command palette re-bound its document key listener on every keystroke
  (the action list was rebuilt each render into the handler's dependency
  list), and the AI-result array was minted fresh per render into a memo.

- **A DNS-rebinding hole in the outbound fetch guard.** The SSRF check
  resolved a hostname, validated the address, and then `fetch()` resolved the
  same name again to dial — two queries a hostile DNS server answers
  differently, passing the check with a public address and serving the
  connect `127.0.0.1`. Validation now runs inside the resolver the socket
  actually uses, checks every address in the answer, and fails closed on a
  public/private mix.
- **Every route accepted a 50 MB body**, unauthenticated ones included — a
  limit sized for bulk import, inherited globally. The default is now 1 MB
  with the import route exempt, and an over-limit body answers a clean
  `413 PAYLOAD_TOO_LARGE` instead of a stack-logging 500.
- The SPA fallback answered every HTTP method with `index.html` — a POST to a
  mistyped path returned 200, which reads as success to a script. Navigation
  is GET/HEAD; everything else now 404s.
- Node's 5-second keep-alive default sat below every reverse proxy's reuse
  window, surfacing as sporadic 502s. Now 65 seconds.

### Changed

- Every response carries `X-Content-Type-Options: nosniff` (previously
  `/uploads` only), `X-Frame-Options: DENY`, and a referrer policy. Production
  adds a CSP with `script-src 'self'` — the built `index.html` has no inline
  script, which is what makes the strict policy possible.
- **`aiService.ts` (1,557 lines, four unrelated domains) is now five domain
  modules** — contact parsing, relationship intelligence, mentions, search
  intelligence, shared helpers — behind the same import path, so no call
  site changed.
- **One schema translator serves all three AI adapters.** The three copies
  had drifted; the OpenAI/compat copy dropped a nullable object's properties
  outright. The dialect differences (nullable form, object sealing) are now
  two documented options, and the trap is closed with a test on it.
- The four SQL statements on the per-request auth path are compiled once at
  module load instead of per call (measured ~6× per statement), matching the
  repository's existing convention. `PRAGMA optimize` now runs daily and on
  shutdown.
- `react-hooks/exhaustive-deps` is an error now that its count is zero —
  all 14 warnings reviewed and fixed individually, per the config's ratchet
  policy.

## [1.5.3] — 2026-08-09

A self-hosted release. The headline fix is that a local model server connected
through Settings → AI now actually answers requests; the rest is a sweep of
readability and clarity work across the UI, and the end of a long-running test
flake.

### Fixed

- **A custom OpenAI-compatible endpoint failed every AI request while
  appearing correctly connected.** Adding an Ollama, vLLM, or LM Studio server
  and leaving the capabilities on **Automatic** — which is what you get by
  adding an endpoint and changing nothing else — resolved to the endpoint but
  named no model, and the compat adapter refuses to be called without one. The
  result was `a model must be selected for OpenAI-compatible endpoints` on
  every Magic Paste, mention, or summary, from a settings page reporting the
  endpoint as connected.

  The three built-in providers map a capability onto a model themselves, so
  Automatic passes them no model on purpose. A compat endpoint has no such map,
  so Automatic now names one: the first chat model in the catalog discovered
  from the endpoint. Quick and Deep get the same model, because nothing in the
  OpenAI-compatible model list says which of yours is the cheaper one and
  guessing from model names would be a judgement the user cannot see — pin them
  separately if you run both a small and a large model.

  When discovery found no chat model there is nothing to call, so Automatic now
  skips the endpoint and the capability reports itself unavailable naming the
  endpoint and the fix, instead of failing later with a message about model
  ids.

- **Settings → AI listed every custom endpoint twice**, and the second copy
  carried a "remove" button that removed nothing: it deleted from the
  provider-key store, where an endpoint has no entry, then reported success.
  Endpoints now appear once, in their own section, which is also where their
  discovered model count, discovery errors, and a refresh button now live.

- **A capability pinned to a deleted provider kept pointing at it.** Quick,
  Deep, and Research fall back to Automatic with a warning, but Embeddings
  resolved straight to the dead provider and every embed threw — semantic
  search and duplicate detection stopped working with nothing in the UI to
  explain why, because the pin still looked valid. Removing a provider or an
  endpoint now returns anything pinned to it to Automatic.

- Saving a provider key or an endpoint that then fails its connectivity check
  left the settings list stale. The credential is stored before it is
  validated — deliberately, so a typo does not cost you the key you just typed
  — so the failed save had still changed the page.

- **The duplicate badge counted the wrong thing.** It read pending _pairs_
  while the review queue groups pairs into clusters, because (A,B) and (B,C)
  are one problem with three people rather than two problems. The badge
  promised 7 and the page showed 3.

- The bulk selection toolbar was 80% transparent, so the contact list showed
  through the controls that archive and delete in bulk. The map opened centred
  on longitude 0, putting the Atlantic in the middle, and left empty background
  above and below the world on a tall window. The AI usage feed's separators
  referenced a colour token that did not exist, so Tailwind dropped the class
  and they rendered in near-black.

- An un-researched contact's Dossier tab was blank — every section in it is
  conditional. It now says what a dossier holds and links to Contact
  Enrichment.

- Five of the fourteen AI cache tiers and operations had no display name, so
  the tier table and activity feed printed raw keys like `queryParse` beside
  properly named rows. All fourteen now have a name and an explanation of what
  the tier caches.

- Startup logged both vector stores at their creation width — 768 for
  `contact_embeddings`, 384 for `search_embeddings` — regardless of what they
  actually held. Those literals only apply to a fresh database; choosing a different
  embeddings model rebuilds the tables at that model's width. Vector width is
  the first thing you check when embeddings misbehave, so a hardcoded number
  there is worse than no number. Both lines now read the width back from the
  table.

- **CI's image-architecture check could only ever fail.** It grepped the raw
  manifest for `"architecture":"amd64"`, but current buildx pretty-prints
  `--raw`, so the compact-JSON pattern never matched and `merge-image` reported
  a missing platform on every push while publishing a perfectly good
  two-architecture image. Parsed with `jq` now, filtered to `os == "linux"` so
  the per-platform provenance attestations are not counted as platforms.

- **The integration suite's long-running flake is fixed at the source.**
  `request(app)` makes supertest bind a fresh HTTP server and tear it down for
  every single request — roughly 500 listen/close cycles a run. Ephemeral ports
  recycle faster than closed sockets leave `TIME_WAIT`, so a new server
  occasionally inherited a port a previous connection was still addressing and
  a request was answered by the wrong socket. The symptom was a status the
  route cannot produce: a 404 from a registered path, a 403 from a router with
  no 403 in it, a 401 on an un-gated instance — each one an invitation to audit
  auth code that was never involved.

  Each test file now listens once and every request goes to that server, which
  removes the recycling. Measured at roughly one failed run in six before, and
  none in thirty after; the `retry: 2` that had been absorbing it is gone, so
  the suite reports instability instead of hiding it.

### Added

- **The health score explains itself.** Clicking the badge on the Pulse
  at-risk list breaks the number into its five signals with the measurement
  behind each — "last contact 200 days ago, against a 90-day cadence" rather
  than "42". A score attached to a person is a judgement, and one you cannot
  interrogate is one you either over-trust or ignore.
- **Settings has a filter.** Five groups and a dozen destinations is past where
  scanning beats typing. Items match synonyms too, so "logout" finds Account
  and "bin" finds Trash.
- **Shift-click selects a range and Cmd/Ctrl+A selects everything visible.**
  Ranges add rather than toggle — shift-clicking across selected rows and
  having them flip off is never what "select from here to there" means. The
  shortcut is ignored while focus is in a field.
- **Session lifetime is configurable** (1 day to 1 year, presets in Settings →
  Account) rather than fixed at 30 days. It applies to new sign-ins only, which
  the card says out loud, because someone shortening it to lock out a lost
  device would otherwise believe they had.
- A tooltip on every AI cache tier explaining what it caches and what a hit
  saved. It opens on click as well as hover, because neither hover nor the
  `title` attribute exists on a phone.
- An end-to-end test suite for compat endpoints, running against a stub server
  that speaks the OpenAI wire format. It covers the case the bug above lived
  in — an install whose only provider is a custom endpoint, with everything on
  Automatic — through the real adapter, real base-URL handling, and real model
  discovery.

### Changed

- Duplicates now leads the Organize group, ahead of Lists. It is the one
  destination there with work queued behind it, and a queue nobody sees is a
  queue nobody clears.
- Sign-out lives only on Settings → Account. Two doors to the same action is
  one more than it needs.
- The empty Network view leads with Import rather than "Add contact". Nobody
  builds a personal CRM by typing four hundred people in by hand.
- The first-run setup screen names how many contacts are waiting and states
  they will be assigned to the account being created; the sign-in screen now
  distinguishes an expired session from an ordinary visit.
- The active letter on the alphabet rail is marked on the rail itself. The
  floating marker it replaces covered contact names.

## [1.5.2] — 2026-08-07

### Added

- **Accounts replace the access token.** A gated instance now shows a one-time
  setup screen that creates your account (email + username + password), then a
  real sign-in screen. Sessions are server-side rows lasting 30 days, so
  signing out actually ends the session and "sign out other devices" works.
  Settings → Account holds your profile, password, and the list of devices
  you're signed in on; the sidebar gets a sign-out button.

  Passwords use scrypt (N=2^16, r=8, p=1) from `node:crypto` — no new native
  dependency. Cost parameters are stored inside each hash, so raising them
  later upgrades passwords silently on next sign-in. The session cookie holds a
  random secret and the database stores only its SHA-256, so neither the
  database nor one of the rotating backups yields a live session.

  Existing data is not disturbed: everything already in the database is
  assigned to the account you create. There is no reset email — this is
  self-hosted with no mail server — so
  [Configuration](docs/configuration.md#authentication--remote-access)
  documents the recovery procedure.

- **`ownerId` on `contacts`, `lists`, `ai_invocations` and `dedupe_merge_log`**
  — every table not reachable from `contacts` through a foreign key. Nothing
  filters on it yet; it exists so that adding multi-tenancy later is "scope the
  queries" rather than "scope the queries AND migrate live data". `NULL` means
  "belongs to whoever owns this instance", which is every row until an account
  exists. `ON DELETE RESTRICT`, so a stray `DELETE FROM users` fails loudly
  instead of taking the contacts with it.

- **Provider contract tests** (`npm run test:contract`) — a suite that calls
  real provider APIs to verify the things a mocked test cannot: that
  `listModels` speaks the shape we parse, that structured output returns
  parseable JSON, and that `embed` returns one vector per input. Both provider
  bugs found in 1.4.0 were wire-format mismatches invisible to mocked tests, and
  one of them had a green unit test asserting the wrong shape.

  Not part of CI and not required for development. Each provider block skips
  itself when its credential is absent, so `npm test` remains key-free and
  contributors with a single key exercise only that provider.

### Changed

- **`AUTH_TOKEN` is now `API_TOKEN`**, and means something narrower: the
  credential for scripts, cron jobs and MCP clients, sent as
  `Authorization: Bearer`. People sign in with an account instead. The old name
  still works with a deprecation warning at startup. `AUTH_REQUIRED` keeps its
  name and its `false` default, in Docker as well as locally — the server warns
  at startup when it binds a non-loopback address with auth off.

- Settings → AI now says _why_ a capability is unavailable and what to do about
  it, instead of "nothing available". A self-hosted setup is told that research
  runs through SearXNG — which is accurate, since enrichment works through
  SearXNG even though no provider resolves for the capability.
- Pinning an embeddings model now probes it first and refuses the assignment if
  the provider cannot actually produce a vector. Compat servers advertise bare
  model ids, so embedding capability is guessed from the name; a model that
  looks right on a server without `/v1/embeddings` previously saved a pin that
  silently left the vector store on the old model.

### Fixed

- **Settings → AI reported embeddings as unavailable when it was working.** The
  view resolved every capability except embeddings, so the Auto row rendered an
  amber "nothing available" against a capability served correctly by the
  built-in local model. It now reads "Built-in local model · 384-dim".
- **OpenAI structured output was rejected outright.** The adapter sent
  `strict: true`, which requires `required` to list every key in `properties` —
  but Contrack's schemas have genuinely optional fields (a contact has a name;
  it may not have a company). Every schema-constrained OpenAI call failed with
  `400 Invalid schema for response_format`. As with the Anthropic bug, a unit
  test asserted the broken shape and stayed green. Found by the contract suite
  on its first run against a working key.
- **Changing the embeddings model left the dedupe index at the old width.** The
  settings route rebuilt only the search store, so `contact_embeddings` stayed
  at 384 while new vectors were 1536 and every insert failed with
  `Expected 384 dimensions but received 1536` until the process restarted. Both
  stores now rebuild together, with an integration test asserting they stay the
  same width.
- Contract tests no longer fail on a credential the provider rejects. A stale
  `OPENAI_API_KEY` exported globally for an unrelated tool — common on a
  developer machine — turned the suite red for someone who never meant to test
  that provider. Credentials are probed once up front: rejected ones skip with
  the reason, and only a real adapter fault fails.
- The integration suite no longer makes outbound network calls. Two tests
  stored a key for a built-in provider, which reached the real vendor to
  validate it — the only flaky tests in the suite. They now use a custom
  endpoint pointed at a closed port, which fails immediately and
  deterministically; real provider behaviour is covered by the contract suite.

## [1.4.0] — 2026-08-05

Contrack no longer asks you to pick "an AI provider". You connect whichever
services you have keys for, and each kind of work is routed to a suitable
model. One API key is still all you need — everything else is optional.

### Added

- **Capability-based AI configuration.** Four independent settings — Quick
  tasks, Deep tasks, Embeddings, and Web research — each resolved from
  Settings → AI, an environment variable, or automatically. Providers are no
  longer mutually exclusive; connect several and mix them across tasks.
- **Model discovery.** Saving an API key queries the provider's list-models
  endpoint, which validates the credential and fills the model dropdowns, so
  new releases appear without a Contrack update. Cached 24h, refreshable on
  demand, and populated in the background at startup. Gemini and Anthropic
  report capabilities directly; OpenAI-shaped servers are inferred from the
  model name and marked as guessed.
- **Custom OpenAI-compatible endpoints.** One adapter for Ollama, vLLM, LM
  Studio, llama.cpp, OpenRouter, xAI, DeepSeek, and Mistral — configured with
  a base URL and optional key. Structured output is negotiated per model
  (`json_schema` → `json_object` → prompt) and the working mode is remembered.
- **Self-hosted web research via SearXNG.** Point Contrack at a SearXNG
  instance to enrich contacts from the live web with no cloud provider. With a
  local chat model and the built-in embeddings, the entire AI stack can run on
  your own hardware.
- **Per-task model overrides:** `AI_QUICK_MODEL`, `AI_DEEP_MODEL`,
  `AI_RESEARCH_MODEL`, and `AI_EMBEDDINGS_MODEL`, each accepting `model` or
  `provider:model`. Intended for declarative deployments; a pin made in
  Settings takes precedence.

### Changed

- **`.env.example` rewritten in tiers** — one key at the top, everything else
  optional and commented out. Previously it framed keys as conditional on
  `AI_PROVIDER`, implying you had to choose a provider before anything worked.
- **`AI_PROVIDER` is now only the Auto preference.** It selects which provider
  Auto favours when several keys are present, and does nothing with one key.
  Existing deployments are unaffected.
- **Settings → AI collapses to a single line** ("All tasks → provider, chosen
  automatically") with per-task controls behind a disclosure that opens
  automatically when anything is pinned.
- **Duplicate-detection embeddings now follow the Embeddings setting**, and
  default to the built-in local model. They previously called Gemini directly
  regardless of the setting, so choosing a local model still sent every
  contact to Google.
- Magic Paste output is now sanitized before it reaches a contact record —
  length caps, control-character stripping, injection-echo rejection, and URL
  validation.

### Fixed

Two of these affect data written by v1.3.0. If you ran that version, the
indexes below repair themselves automatically on first start.

- **Gemini embeddings returned one vector per batch instead of one per
  contact.** `contents: string[]` reads as a single Content with many parts,
  so each batch collapsed into one vector and the rest were silently dropped.
  Switching the Embeddings setting to a Gemini model left the semantic index
  almost entirely empty while reporting success.
- **Duplicate-detection embeddings had the same defect**, plus a backfill that
  only ran when the store was completely empty — so a partial index could
  never repair itself. On a 431-contact database it held 5 rows. Duplicate
  matching has been running without the semantic signal it was designed
  around. Restoring it raises match scores but crossed no auto-merge
  thresholds in testing (0 of 381 candidate pairs).
- **Anthropic structured output was broken entirely.** `output_config.format`
  takes the schema directly, but Contrack sent OpenAI's nested `json_schema`
  wrapper, so every JSON operation on Anthropic failed with a 400. Only
  text-only calls worked. Claude also caps schemas at 24 optional parameters,
  which the research schema exceeds; that case now falls back to
  prompt-guided JSON instead of failing.
- A provider returning fewer embeddings than inputs is now a hard error rather
  than a silently short batch, and the backfill refuses to write a partial
  index.
- OpenAI-compatible backends that return `200 OK` with a non-JSON body now
  trigger the structured-output downgrade, not just those that reject the
  format outright.
- Reasoning models (gemma-4, QwQ, DeepSeek-R1) that spend their whole token
  budget on `reasoning_content` now report that explicitly instead of
  surfacing as "malformed JSON".
- `data/` is excluded from version control — it holds the auth token,
  uploads, and backups.
- **Container images are now published for `linux/arm64` as well as
  `linux/amd64`.** Previous releases were amd64-only, so Apple Silicon and ARM
  homelab hosts could not pull them at all.

## [1.3.0] — 2026-08-04

### Added

- Trash view in Settings for restoring or permanently deleting contacts.
- Data lifecycle: soft-delete with retention purge, scheduled SQLite
  snapshots, and full JSON/CSV export.
- Single-user authentication (`AUTH_TOKEN` / `AUTH_REQUIRED`) with an
  HttpOnly cookie and bearer-token support for scripts.

### Changed

- TypeScript `strict` mode enabled across the codebase with real lint
  enforcement in CI.
- Integration tests run HTTP routes against a real SQLite database.
- Heavy startup work moved off the request thread.
- Documentation refresh and release-pipeline improvements.

### Fixed

- Prompt-injection hardening across the AI pipeline: untrusted content is
  fenced and model output is validated before it can be written.
- Soft-merged contacts no longer leak into contact lists.

## [1.1.0] — 2026-08-03

### Added

- Lite-tier model integration and an enhanced hybrid search pipeline.

## [1.0.0] — 2026-08-03

Initial release: local-first AI-powered personal CRM with contact
management, semantic search, AI enrichment, and duplicate detection.

[unreleased]: https://github.com/arvarik/contrack/compare/v1.5.5...HEAD
[1.5.5]: https://github.com/arvarik/contrack/compare/v1.5.4...v1.5.5
[1.5.4]: https://github.com/arvarik/contrack/compare/v1.5.3...v1.5.4
[1.5.3]: https://github.com/arvarik/contrack/compare/v1.5.2...v1.5.3
[1.5.2]: https://github.com/arvarik/contrack/compare/v1.4.0...v1.5.2
[1.4.0]: https://github.com/arvarik/contrack/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/arvarik/contrack/compare/v1.1.0...v1.3.0
[1.1.0]: https://github.com/arvarik/contrack/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/arvarik/contrack/releases/tag/v1.0.0
