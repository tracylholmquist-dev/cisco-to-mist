# Cisco → Mist Wired Assurance Converter

A browser-based tool that converts Cisco IOS switch CLI configurations into Juniper Mist Wired Assurance org-level network templates, then pushes them directly to the Mist API — no terminal required.

**Live tool:** https://github.com/tracylholmquist-dev/cisco-to-mist

---

## Problem Statement

Network engineers migrating from Cisco IOS switching to Juniper Mist Wired Assurance must manually translate switch configurations between two fundamentally different paradigms. Cisco uses interface-level CLI commands; Mist uses a declarative JSON API with shared port-usage profiles, VLAN networks, and port-range notation. This translation is time-consuming, error-prone, and requires deep knowledge of both platforms.

This tool automates the conversion. An engineer pastes a Cisco running-config, reviews the generated Mist JSON, and pushes the resulting org-level network template to their Mist org in a single browser session.

---

## Architecture

```
┌─────────────────────────────────────┐
│   Browser  (Netlify static site)    │
│                                     │
│  ┌───────────────────────────────┐  │
│  │  index.html                   │  │
│  │  • Cisco config parser        │  │
│  │  • Mist JSON builder          │  │
│  │  • Port-range compressor      │  │
│  │  • Push / Test UI             │  │
│  └──────────────┬────────────────┘  │
└─────────────────│───────────────────┘
                  │ same-origin fetch (no CORS)
                  ▼
┌─────────────────────────────────────┐
│  Netlify Serverless Function        │
│  netlify/functions/mist-proxy.js    │
│  • Receives { targetUrl, method,    │
│    token, payload } from browser    │
│  • Forwards request server-side     │
└──────────────┬──────────────────────┘
               │ HTTPS (server-to-server)
               ▼
┌─────────────────────────────────────┐
│  Juniper Mist API                   │
│  api.mist.com  (or regional GC/AC)  │
│  POST /api/v1/orgs/{id}/            │
│       networktemplates              │
└─────────────────────────────────────┘
```

The serverless proxy is the key architectural decision. Browsers block direct cross-origin API calls (CORS); the proxy runs server-side where CORS does not apply, keeping the deployment fully static with no dedicated backend.

---

## Repository Structure

```
cisco-to-mist/
├── index.html                  # Single-page converter app (all logic inline)
└── netlify/
    └── functions/
        └── mist-proxy.js       # Serverless CORS proxy for Mist API calls
```

---

## Setup Instructions

### Prerequisites

- A free [GitHub](https://github.com) account
- A free [Netlify](https://netlify.com) account

### Deploy to Netlify via GitHub

1. **Fork or clone this repository** into your own GitHub account.

2. **Log in to Netlify** → click **Add new site → Import from Git**.

3. **Connect to GitHub** and select the `cisco-to-mist` repository.

4. **Leave all build settings blank** — no build command, no publish directory override needed.

5. Click **Deploy site**.

Netlify automatically detects the `netlify/functions/` directory and deploys `mist-proxy.js` as a serverless function alongside the static HTML. The deployment takes roughly 30 seconds.

6. **Optionally rename your site** under **Site configuration → General → Site details → Change site name** to get a memorable URL like `https://cisco-to-mist.netlify.app`.

### Local Development

Open `index.html` directly in a browser for conversion and JSON preview. Note: **Test Connection** and **Push to Mist API** require the Netlify proxy and will not work from `file://`. Use the **Copy as cURL** button as a terminal fallback when developing locally.

---

## Usage

1. Open the tool URL in any browser.
2. **Paste** your Cisco IOS switch running-config into the left panel, or **drag-and-drop** a `.txt` config file.
3. Click **Convert** — the right panel shows the generated Mist JSON and a port mapping table.
4. Open the **Push to Mist API** drawer and enter:
   - **Org ID** — found in Mist under Organization → Settings
   - **API Token** — generated in Mist under My Profile → API Token
   - **Cloud Region** — select the Mist cloud your org is on
   - **Template ID** *(optional)* — provide an existing template ID to update (PUT) rather than create (POST)
5. Click **Test Connection** to validate your credentials before pushing.
6. Click **Push Now** to create or update the network template in your Mist org.

---

## What Gets Converted

| Cisco Feature | Mist Equivalent |
|---|---|
| `switchport mode access` | `port_usages` access profile |
| `switchport mode trunk` | `port_usages` trunk profile |
| `switchport trunk native vlan N` | `port_network` on trunk profile |
| `switchport trunk allowed vlan ...` | `networks` list or `all_networks: true` |
| `switchport access vlan N` | `port_network` on access profile |
| `switchport voice vlan N` | `voip_network` on access profile |
| `channel-group N mode active` | `aggregated: true`, `ae_idx: N` on physical ports |
| `spanning-tree mode pvst` / `rapid-pvst` | `stp_config: { mode: "rstp" }` |
| `spanning-tree portfast` | `stp_edge: true` on port profile |
| Description starting with `AP` | Shared `Mist-APs` trunk profile (PoE on, all networks) |
| Consecutive same-config ports | Mist port-range notation (`ge-0/0/3-7`) |
| `interface VlanX / description Y` | VLAN name `Y` in `networks` object |
| `dot1x system-auth-control` | `port_auth: "dot1x"` on applicable profiles |
| NTP server | `ntp_servers` array |
| SNMP community | `snmp_config` |

**Interface offset:** Cisco numbers interfaces from 1 (GigabitEthernet**1**/0/**1**); Junos from 0 (ge-**0**/0/**0**). The converter applies the offset automatically on all stack/port numbers.

**Port-channel interfaces** are not written to `port_config`. Only physical member ports are configured, with LACP fields (`aggregated`, `ae_idx`, `ae_disable_lacp`) applied directly to the member port entries.

---

## Example Output

Given a Cisco interface block:

```
interface GigabitEthernet1/0/7
 description AP-Port
 switchport trunk native vlan 11
 switchport trunk allowed vlan 11,21,31,41
 switchport mode trunk
!
interface GigabitEthernet1/0/8
 description AP-Port
 switchport trunk native vlan 11
 switchport trunk allowed vlan 11,21,31,41
 switchport mode trunk
```

The converter produces:

```json
{
  "port_usages": {
    "Mist-APs": {
      "mode": "trunk",
      "port_network": "management",
      "all_networks": true,
      "poe_disabled": false,
      "stp_edge": false,
      "description": "Mist AP trunk port"
    }
  },
  "port_config": {
    "ge-0/0/6-7": {
      "usage": "Mist-APs",
      "description": "AP-Port",
      "critical": false,
      "no_local_overwrite": false,
      "dynamic_usage": null
    }
  }
}
```

The two physical interfaces are compressed into a single port-range entry and share one named port profile.

---

## Supported Mist Cloud Regions

| Region | API Endpoint |
|---|---|
| Global 01 (default) | `api.mist.com` |
| Global 02 | `api.gc1.mist.com` |
| Global 03 | `api.ac2.mist.com` |
| Global 04 | `api.gc2.mist.com` |
| Global 05 | `api.gc4.mist.com` |
| EMEA 01 | `api.eu.mist.com` |
| EMEA 02 | `api.gc3.mist.com` |
| EMEA 03 | `api.ac6.mist.com` |
| EMEA 04 | `api.gc6.mist.com` |
| APAC 01 | `api.ac5.mist.com` |
| APAC 02 | `api.gc5.mist.com` |
| APAC 03 | `api.gc7.mist.com` |

---

## Mist API Reference

- **Create template:** `POST /api/v1/orgs/{org_id}/networktemplates`
- **Update template:** `PUT /api/v1/orgs/{org_id}/networktemplates/{template_id}`
- **API docs:** https://www.juniper.net/documentation/us/en/software/mist/automation-integration/

---

## License

MIT
