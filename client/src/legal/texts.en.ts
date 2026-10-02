import type { LegalContext, LegalTexts } from './types';

/**
 * Legal texts in English (P4): a translation of texts.it.ts, which is the reference version. DRAFT to be reviewed by
 * a professional before publication.
 */
export function englishTexts(c: LegalContext): LegalTexts {
  const recipients =
    c.hosting.kind === 'vps'
      ? `The server is hosted by ${c.hosting.provider}, in a data centre in ${c.hosting.country}, which processes data on behalf of the controller as a processor (Art. 28 GDPR), under its data processing agreement.`
      : 'The server runs on a computer owned by the controller. Traffic goes through Cloudflare, Inc., which provides the encrypted connection (HTTPS) and network protection and processes data in transit (including IP address and request content) as a processor (Art. 28 GDPR).';
  const transfers =
    c.hosting.kind === 'vps'
      ? 'If the provider’s data centre is outside the European Economic Area, the transfer relies on an adequacy decision of the European Commission or on the standard contractual clauses of the agreement with the provider. There are no other transfers outside the EU.'
      : 'Cloudflare, Inc. is based in the United States and participates in the EU-U.S. Data Privacy Framework: transfers rely on it and on the standard contractual clauses of its data processing agreement.';

  return {
    privacy: {
      title: 'Privacy notice',
      intro: `How CheckMage processes your personal data, under Articles 13 and 14 of Regulation (EU) 2016/679 (GDPR). Effective from ${c.effectiveDate}.`,
      sections: [
        { title: 'Data controller', body: [`The controller is ${c.owner}, whom you can contact about your data at ${c.email}.`] },
        {
          title: 'What data we process',
          body: [
            {
              list: [
                'Account data: username, email address, password (stored only as an irreversible bcrypt hash), sign-up date, accepted terms version and acceptance date.',
                'Game data: ELO rating, games played (players, result, moves, time control, date, rated or friendly), card collection and decks.',
                'Social data: friendships, friend requests, blocked players and challenges (the latter only in memory, for at most 60 seconds).',
                'Online status: while the app is open your device sends a signal every few seconds; the status (online, in a game, offline) is kept only in memory and is lost after 30 seconds without signals or when the server restarts. You can hide it in Settings.',
                'Technical data: your IP address, used only in memory to limit excessive requests and never stored in the database; server technical logs (method, path, result and duration of requests, without their parameters), kept on a rotating basis with a limited maximum size.',
              ],
            },
            'We do not collect payment data, location, contacts or special categories of data, and we use no analytics, advertising or profiling tools.',
          ],
        },
        {
          title: 'Why we process it and on what basis',
          body: [
            {
              list: [
                'Creating and managing your account, letting you play, computing the ranking and providing social features: performance of the contract, i.e. the Terms of service you accept when signing up (Art. 6(1)(b) GDPR).',
                'Protecting the service from abuse and attacks (request limits, technical logs, suspension of accounts that break the Terms): the controller’s legitimate interest in the security of the service (Art. 6(1)(f) GDPR).',
                'Complying with legal obligations and, if needed, defending legal claims (Art. 6(1)(c) and (f) GDPR).',
              ],
            },
            'Username, email and password are required to sign up: without them you cannot use the service.',
          ],
        },
        {
          title: 'What others can see',
          body: [
            'Your username, ELO, sign-up date and game statistics are public: they appear on your profile and in the ranking, visible even without an account. Registered users can also see your game history and your online status (unless you hide it), and can find you by searching your name. Your email address is never shown to others.',
          ],
        },
        { title: 'Who receives the data', body: [recipients, 'We do not sell or hand over data to third parties. We may disclose it to authorities only when the law requires it.'] },
        { title: 'Transfers outside the European Union', body: [transfers] },
        {
          title: 'How long we keep it',
          body: [
            {
              list: [
                'Account and related data: as long as the account exists; you can delete it whenever you want.',
                'On deletion: email, password, decks, collection, friendships, requests and blocks are removed immediately; games already played stay in your opponents’ history, with your name replaced by “Deleted player”.',
                'Online status and challenges: only in memory, for a few seconds or minutes.',
                'Technical logs: rotating, overwritten when they reach a maximum size.',
                `Database backups: kept for ${c.backupDays} days and then deleted; until then they may still contain an account that has been deleted.`,
              ],
            },
          ],
        },
        {
          title: 'Cookies and device storage',
          body: [
            'CheckMage does not use cookies. It stores in your browser’s storage (localStorage) or in the app only:',
            { list: ['your sign-in data (tokens), to keep you signed in;', 'the language and board theme you chose;', 'whether you have a game in progress, to resume it.'] },
            'These are strictly necessary for the service you ask for or to remember your choices, so the law does not require consent (Art. 122 of the Italian Privacy Code and the Italian DPA’s cookie guidelines of 10 June 2021): that is why you see no banner. There are no analytics, profiling or third-party cookies, and fonts are served by our own server.',
          ],
        },
        { title: 'Minors', body: [`The service is reserved for people aged ${c.minimumAge} or older. If we find out an account belongs to someone younger, we delete it.`] },
        {
          title: 'Your rights',
          body: [
            'You can ask at any time for access to your data, rectification, erasure, restriction of processing, portability, and object to processing based on legitimate interest (Articles 15–21 GDPR).',
            `In Settings you can download all your data and delete your account yourself; for anything else write to ${c.email}: we reply within one month.`,
            'You also have the right to lodge a complaint with the Italian Data Protection Authority (www.garanteprivacy.it) or with the supervisory authority of the country where you live.',
          ],
        },
        {
          title: 'Automated decisions',
          body: ['The ELO rating and queue matchmaking are automatic calculations based on game results, with no legal or similarly significant effects on you. We do not profile you.'],
        },
        {
          title: 'Security',
          body: [
            'We use encrypted connections (HTTPS), bcrypt-hashed passwords, a database reachable only by the server and request limits. If a data breach puts you at risk, we notify the Italian DPA within 72 hours and, if the risk is high, you as well.',
          ],
        },
        { title: 'Changes', body: ['We update this notice when the service changes. Substantial changes will be shown to you at your next sign-in and you will need to accept them to keep playing.'] },
      ],
    },

    terms: {
      title: 'Terms of service',
      intro: `The rules for using CheckMage. Effective from ${c.effectiveDate}.`,
      sections: [
        {
          title: 'The service',
          body: [`CheckMage is a chess game with magic cards, offered free of charge by ${c.owner} (contact: ${c.email}). By signing up you accept these Terms and confirm you have read the Privacy notice.`],
        },
        {
          title: 'Who can sign up',
          body: [
            {
              list: [
                `You must be at least ${c.minimumAge} years old.`,
                'You may have only one account.',
                'The email address must be yours; you are responsible for your password and for what happens with your account.',
              ],
            },
          ],
        },
        {
          title: 'Conduct',
          body: [
            'You may not:',
            {
              list: [
                'choose offensive, vulgar or discriminatory usernames, or ones that impersonate other people or contain personal data;',
                'get help from software or people during games (for example chess engines) or automate play;',
                'manipulate the ranking, for example with several accounts or arranged games;',
                'exploit bugs in the service, attack it or overload it;',
                'harass or insult other players.',
              ],
            },
          ],
        },
        {
          title: 'Reports and moderation',
          body: [
            `You can report usernames or misconduct by writing to ${c.email}. If the Terms are broken we may change a username, cancel results, suspend or close the account, explaining why whenever possible.`,
          ],
        },
        {
          title: 'A free service, as is',
          body: [
            'The game is offered with no guarantee of continuous availability. Cards and rules may change or be rebalanced; ratings and game data may be reset after technical problems or for new seasons. The service may be suspended or closed, with reasonable notice whenever possible.',
          ],
        },
        {
          title: 'Liability',
          body: [
            'To the extent permitted by law, the controller is not liable for indirect damages arising from the use of, or inability to use, a free service. Liability for wilful misconduct or gross negligence and protections that cannot be excluded by law, including consumer rights, remain unaffected.',
          ],
        },
        {
          title: 'Intellectual property',
          body: [
            'The game, its graphics and texts belong to their respective authors. Third-party fonts and components are used under their licences (see Credits). You may not copy or redistribute the game without permission.',
          ],
        },
        {
          title: 'Account deletion',
          body: [`You can delete your account whenever you want, from Settings (“Delete account”) or by writing to ${c.email}. You can also stop using the service without notice.`],
        },
        { title: 'Changes to the Terms', body: ['Substantial changes will be shown to you at your next sign-in. If you do not accept them you can delete your account.'] },
        {
          title: 'Governing law',
          body: [
            'These Terms are governed by Italian law. If you are a consumer, the courts of the place where you live or are domiciled have jurisdiction, and the mandatory protections of your country of residence remain unaffected.',
          ],
        },
      ],
    },

    accountDeletion: {
      title: 'Account deletion',
      intro: 'How to delete your CheckMage account and what happens to your data. Applies to the website and the Android app.',
      sections: [
        {
          title: 'How to do it',
          body: [
            'Sign in to the website or the app, open Settings, Privacy section, choose “Delete account”, enter your password and confirm.',
            `Can’t sign in? Write to ${c.email} from your account’s email address: we delete the account within one month.`,
          ],
        },
        {
          title: 'What is deleted immediately',
          body: [{ list: ['email, password and username;', 'decks and card collection;', 'friendships, requests, blocks and settings;', 'the record of the accepted terms.'] }],
        },
        {
          title: 'What remains',
          body: [
            {
              list: [
                'Games already played, because they are part of your opponents’ history: your name is replaced by “Deleted player” and they are no longer linked to your data.',
                `Database backups, which are deleted within ${c.backupDays} days.`,
              ],
            },
          ],
        },
        { title: 'It is permanent', body: ['A deleted account cannot be recovered. If you like, download your data from Settings first.'] },
      ],
    },

    credits: {
      title: 'Credits',
      intro: 'Thanks to the projects CheckMage is built on.',
      sections: [
        { title: 'Fonts', body: ['Figtree, Cinzel, JetBrains Mono and Noto Sans Symbols 2 (subset to the chess pieces), under the SIL Open Font License 1.1, served by our own server.'] },
        { title: 'Chess engine', body: ['Stockfish (GNU General Public License v3), used on the server to validate moves.'] },
        {
          title: 'Open source software',
          body: [
            'Client: React, React Router, Zustand, Zod, i18next, chess.js, Capacitor, Vite and Tailwind CSS. Server: Go, chi, Gorilla WebSocket, golang-jwt, zap and lib/pq. All distributed under open source licences (MIT, BSD, Apache or similar).',
          ],
        },
        { title: 'Graphics', body: ['Icons, card symbols and the app icon were designed for this project.'] },
      ],
    },
  };
}
