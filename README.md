[README.md](https://github.com/user-attachments/files/26938492/README.md)
# Multi-Vendor Switch Config → Juniper Mist Wired Assurance Converter

A browser-based tool that converts CLI switch configurations from Cisco IOS/IOS-XE, Juniper EX (Junos), Arista EOS, and Aruba CX into Juniper Mist Wired Assurance org-level network templates, then pushes them directly to the Mist API — no terminal required.

---

## Problem Statement

Network engineers migrating to Juniper Mist Wired Assurance must manually translate switch configurations between fundamentally different paradigms. Vendor CLIs use interface-level commands; Mist uses a declarative JSON API with shared port-usage profiles, VLAN networks, and port-range notation. This translation is time-consuming, error-prone, and requires deep knowledge of both platforms.

This tool automates the conversion. An engineer pastes a running-config (or drags and drops a config file), reviews the generated Mist JSON, and pushes the resulting org-level network template directly to their Mist org in a single browser session.

---

## Supported Vendors

| Vendor | Platform | Config Style |
|---|---|---|
| Cisco IOS / IOS-XE | Catalyst 9000, 3850, 2960 | `interface GigabitEthernet1/0/1` |
| Juniper EX (Junos) | EX2300, EX3400, EX4300 | `set vlans DATA vlan-id 10` (set-style and hierarchical) |
| Arista EOS | DCS-7000 series | `interface Ethernet1` |
| Aruba CX (AOS-CX) | CX 6000/6100/6300 | `interface 1/1/1` |

The vendor is detected automatically from the config syntax — no manual selection required.

---

## Architecture

```
┌─────────────────────────────────────┐
│   Browser  (Netlify static site)    │
│                                     │
│  ┌───────────────────────────────┐  │
│  │  index.html                   │  │
│  │  • Vendor auto-detection      │  │
│  │  • Per-vendor config parsers  │  │
│  │  • Mist JSON template builder │  │
│  │  • Port-range compressor      │  │
│  │  • Conversion summary tab     │  │
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
├── index.html                        # Single-page converter app (all logic inline)
├── netlify/
│   └── functions/
│       └── mist-proxy.js             # Serverless CORS proxy for Mist API calls
└── sample-configs/
    ├── sample-cisco-ios-l2.cfg       # Cisco IOS — Layer-2 only
    ├── sample-cisco-ios-l3-static.cfg # Cisco IOS — Layer-3, static routes
    ├── sample-arista-eos-l2.cfg      # Arista EOS — Layer-2 only
    ├── sample-arista-eos-l3-static.cfg # Arista EOS — Layer-3, static routes
    ├── sample-aruba-cx-l2.cfg        # Aruba CX — Layer-2 only
    ├── sample-aruba-cx-l3-static.cfg  # Aruba CX — Layer-3, static routes
    ├── sample-junos-ex-l2.cfg        # Juniper EX — Layer-2 only
    ├── sample-junos-ex-l3-static.cfg  # Juniper EX — Layer-3, static routes
    └── sample-junos-ex.cfg           # Juniper EX — Layer-3 with OSPF (full example)
```

---

## Setup Instructions

### Prerequisites

- A free [GitHub](https://github.com) account
- A free [Netlify](https://netlify.com) account

### Deploy to Netlify via GitHub

1. **Fork or clone this repository** into your own GitHub account.

2. **Log in to Netlify** → click **Add new site → Import from Git**.

3. **Connect to GitHub** and select the repository.

4. **Leave all build settings blank** — no build command, no publish directory override needed.

5. Click **Deploy site**.

Netlify automatically detects the `netlify/functions/` directory and deploys `mist-proxy.js` as a serverless function alongside the static HTML. The deployment takes roughly 30 seconds.

6. **Optionally rename your site** under **Site configuration → General → Site details → Change site name** to get a memorable URL.

### Local Development

Open `index.html` directly in a browser for conversion and JSON preview. Note: **Test Connection** and **Push to Mist API** require the Netlify proxy and will not work from `file://`. Use the **Copy as cURL** button as a terminal fallback when developing locally.

---

## Usage

1. Open the tool URL in any browser.
2. **Paste** your switch running-config into the left panel, or **drag-and-drop** a config file. The vendor is detected automatically.
3. Click **Convert** — the right panel shows the generated Mist JSON and a port mapping table. Review the **Summary** tab for a human-readable breakdown of what was parsed.
4. Open the **Push to Mist API** drawer and enter:
   - **Org ID** — found in Mist under Organization → Settings
   - **API Token** — generated in Mist under My Profile → API Token
   - **Cloud Region** — select the Mist cloud your org is on
   - **Template ID** *(optional)* — provide an existing template ID to update (PUT) rather than create (POST)
5. Click **Test Connection** to validate your credentials before pushing.
6. Click **Push Now** to create or update the network template in your Mist org.

---

## What Gets Converted

### VLANs and Networks

| Source Config | Mist Field |
|---|---|
| VLAN definitions (all vendors) | `networks` object — name, VLAN ID |
| SVI / IRB IP address (L3 switches) | `networks[name].subnet` (IPv4) |
| SVI / IRB IPv6 address | `networks[name].subnet6` |

### Port Profiles (`port_usages`)

| Source Config | Mist Equivalent |
|---|---|
| Access port with single VLAN | `port_usages` access profile, `port_network` |
| Voice VLAN (`switchport voice vlan` / `vlan voice`) | `voip_network` on access profile |
| Trunk port | `port_usages` trunk profile |
| Trunk native VLAN | `port_network` on trunk profile |
| Trunk allowed VLANs | `networks` list on trunk profile |
| All VLANs trunk (`vlan members [all]`) | `all_networks: true` |
| Description starting with `AP` or `AP-` | Shared `Mist-APs` trunk profile (PoE on, all networks) |
| `spanning-tree portfast` / `port-type admin-edge` | `stp_edge: true` |
| `channel-group N mode active` / `lag N` | `aggregated: true`, `ae_idx: N` |
| Disabled interface | `disabled: true` |
| PoE disabled | `poe_disabled: true` |
| Consecutive ports with identical config | Compressed to Mist port-range notation (`ge-0/0/3-7`) |

### Routing

| Source Config | Mist Field |
|---|---|
| Static routes (all vendors, CIDR or dotted-mask) | `extra_routes` |
| OSPF area and interface assignments (Junos) | `ospf_config` + `ospf_areas` |
| OSPF passive interfaces | `passive: true` in OSPF networks |

### Infrastructure

| Source Config | Mist Field |
|---|---|
| NTP servers | `ntp_servers` |
| DNS servers | `dns_servers` |
| Domain name / DNS suffix | `dns_suffix` |
| SNMP community, contact, location, trap hosts | `snmp_config` |
| RADIUS servers | `radius_config` |
| TACACS+ servers | `tacacs_configs` |
| Syslog hosts | `remote_syslog` |
| `spanning-tree mode rapid-pvst` / `rstp` | `stp_config.mode` |
| `lldp run` / `lldp enable` | `additional_config_cmds` |
| `dot1x system-auth-control` | `port_auth: "dot1x"` on applicable profiles |
| Local user accounts | `local_accounts` |
| Login banner | `additional_config_cmds` |

### Interface Numbering Offset

Cisco and Arista number interfaces from 1 (`GigabitEthernet1/0/1`, `Ethernet1`); Junos numbers from 0 (`ge-0/0/0`). The converter applies the offset automatically so all port-config keys use Junos-style numbering regardless of source vendor.

---

## Sample Configurations

The `sample-configs/` directory contains reference configs for all four vendors in two scenarios:

**Layer-2 only** — pure L2 switching with a single management SVI and default gateway. Use these to validate VLAN, port profile, voice VLAN, trunk, and AP port conversion.

**Layer-3 static routes** — full SVI/IRB gateways on every VLAN with static routes. Use these to validate subnet population in `networks` and `extra_routes`. All four L3 static configs produce identical Mist templates, making them useful for cross-vendor comparison testing.

All sample configs share the same VLAN scheme and IP addressing:

| VLAN | Name | Subnet |
|---|---|---|
| 10 | DATA | 192.168.10.0/24 |
| 20 | VOICE | 192.168.20.0/24 |
| 30 | GUEST | 192.168.30.0/24 |
| 40 | SERVERS | 10.40.0.0/24 |
| 99 | MGMT | 10.99.0.0/24 |

---

## Mist Template Fields Produced

The converter generates an org-level network template compatible with:

```
POST /api/v1/orgs/{org_id}/networktemplates
PUT  /api/v1/orgs/{org_id}/networktemplates/{template_id}
```

Top-level fields populated: `name`, `networks`, `port_usages`, `port_config`, `radius_config`, `tacacs_configs`, `snmp_config`, `remote_syslog`, `dhcp_snooping`, `ntp_servers`, `dns_servers`, `dns_suffix`, `extra_routes`, `extra_routes6`, `ospf_config`, `ospf_areas`, `stp_config`, `additional_config_cmds`, `local_accounts`.

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

## Known Limitations

- **OSPF:** Currently parsed from Junos configs only. Arista, Cisco, and Aruba OSPF support is planned.
- **BGP / EIGRP / RIP:** Not converted. Dynamic routing protocols other than OSPF are not supported by the Mist wired template schema.
- **Port-channel master interfaces:** Not written to `port_config`. Only physical member ports are configured, with LACP fields applied directly to the member entries.
- **Policy maps / QoS:** Not converted.
- **ACLs:** Not converted.
- **VRFs:** Not converted (Mist templates use a single routing domain per template).

---

## Mist API Reference

- **API docs:** https://www.juniper.net/documentation/us/en/software/mist/automation-integration/
- **Create template:** `POST /api/v1/orgs/{org_id}/networktemplates`
- **Update template:** `PUT /api/v1/orgs/{org_id}/networktemplates/{template_id}`

---

## License

MIT
