# Sideband IRC · v1.1.0

## Put it on your website

Unzip the archive and upload its contents together to any static HTTPS directory, such as `/sideband/`. Open the page, keep the suggested nickname or enter your own, and click **Connect**. Sideband automatically joins **#defcon** after registration. Hosting needs only static files. There is no build, Docker image, Python service, or local relay.

## How it connects

Your browser opens **wss://wpm.2600.chat/webirc/websocket/**, the WebSocket gateway configured by the [2600net web client](https://scuttled.net/#irc). Sideband requests **irc.2600.net:+6697** using the gateway’s HOST command. The operator controls the upstream connection and can use a fixed server. WSS encrypts the browser-to-gateway connection. The gateway handles IRC traffic and can read messages in transit.

A regular web page cannot open a raw IRC/TLS connection to port 6697. For a direct connection without any gateway, use an installed IRC client with host `irc.2600.net`, TLS port `6697`, and channel `#defcon`.

If your site sets a Content Security Policy, include `wss://wpm.2600.chat` in its `connect-src` directive. The network can restrict accepted website origins. Use an HTTPS site for the real test. A local file may present a null origin. If the connection fails, retry or use **Open 2600net web chat** and replace the channel list with `#defcon`. Access from an individual hosting domain is subject to the network’s policy.

## Chat

Type a message and press **Enter**. Open **Members** and select a nickname to start a direct message. Use the **+** beside Channels to join additional rooms on 2600net. On a phone, open the conversations menu first.

**Commands** lists `/join #channel`, `/part`, `/msg nick text`, `/me action`, `/nick newname`, `/quit`, and `/help`. A double slash at the start sends a literal slash. **Server log** shows IRC replies, including channel or message refusals. Outgoing messages appear when handed to the browser’s send queue. IRC does not guarantee delivery.

**Display** offers Night, Day, and High contrast. The browser remembers the theme and last nickname. The last 500 events per conversation, drafts, and rosters stay in tab memory. Disconnect keeps scrollback. Reload or close the tab to clear it. Reconnect starts in #defcon.

Protocol reference: [webircgateway transports, HOST and origin policy](https://github.com/kiwiirc/webircgateway).
