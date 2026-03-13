# ZRO — Bugs corrigés

## Desktop / Shell
- [x] Lock screen : URL `/auth/verify` → `/api/auth/verify` — corrigé
- [x] Ctrl+Shift+R : intercepté quand écran verrouillé + état persisté via sessionStorage — corrigé
- [x] Compteur CPU : le polling 10s existait déjà, fonctionne avec le backend — OK
- [ ] Thème light ne fonctionne pas (priorité basse)

## Applications — Bugs
- [x] **Fichiers** : ajout toolbar (back, path input), créé fichiers/dossiers de démo dans data/files — corrigé
- [x] **Navigateur web** : `new ZroClient()` → `ZroClient.connect()`, CSP ajouté `frame-src *` — corrigé
- [x] **System Monitor** : `new ZroClient()` → `ZroClient.connect()` — corrigé
- [x] **Calculatrice** : remplacé `Function()` (bloqué par CSP) par parser safe shunting-yard, fix minus sign — corrigé
- [x] **Settings** : `new ZroClient()` → `ZroClient.connect()` — corrigé
- [x] **Search/Launcher** : ajouté `category` au endpoint `/api/apps`, fix `entry_to_metadata` — corrigé

## Supprimés
- [x] Clock — supprimé
- [x] Echo Test — supprimé
- [x] Calendar — supprimé
- [x] Media Player — supprimé

## État
- 13 apps actives, 154 tests OK, déployé sur port 8090
