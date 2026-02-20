# CyberDel Local Web App

CyberDel is a local-first Windows web app for cyber security testing operations. It runs through PowerShell with no extra runtime install, while data is shared via one common folder (SharePoint sync or shared local folder).

## Run

```powershell
.\start.ps1 -DataDir "C:\Users\<user>\Company\CyberTierShare" -Port 8787
```

Open: `http://localhost:8787`

Auto-save is enabled (no manual Save changes button).

All date fields use calendar inputs.

## Data model

Configured shared folder stores:

- `assets.json`
- `business-units.json`
- `pentests.json`

## Main tabs

- **Dashboard**: global KPIs for assets and pentest completion.
- **Business Unit**: create/edit BUs and view P0/P1/P2 pentest coverage.
- **Assets**:
  - Add/Edit/Show/Remove assets
  - CSV import with minimum fields: `name,BU,rank`
  - Supports extended asset schema fields and exposure scoring
  - Multi-BU filtering and search
  - Tier distribution and pentest coverage charts
- **Pentest Projects**:
  - Edit lock protection for concurrent editing of assets/projects (findings and reports protected through project lock)
  - Project register with phase and tester ownership
  - Workbench opens as a second/sub panel when creating or opening a project
  - When opened, a subfolder appears under Pentest Projects with the selected project ID and disappears when closed
  - Workbench fields for scope, attack surface, methodology, retest and summary
  - Findings/issues management with severity, status, CVSS, CWE/OWASP and TTP
  - Report management with status/version/reference
- **Settings**:
  - Configure the shared data folder path.

## Local API

- `GET /api/bootstrap`
- `GET/POST /api/assets`
- `GET/POST /api/business-units`
- `GET/POST /api/pentests`
- `GET/POST /api/settings`
- `GET /api/locks`
- `POST /api/locks/acquire`
- `POST /api/locks/release`
- `GET /api/health`

## Scoring

Asset priority uses:

- Impact score from risk impact rating
- Weighted exposure factors
- Crown jewel adjacency multiplier
- Final tier mapping P0..P4
