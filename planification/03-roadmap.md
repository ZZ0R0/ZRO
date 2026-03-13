# ZRO — Roadmap d'implémentation

> Document de planification — Mars 2026
> Objectif : Feuille de route phasée pour transformer ZRO en un environnement de bureau complet dans le navigateur.

---

## Table des matières

1. [Principes directeurs](#1-principes-directeurs)
2. [Phase 1 — Le bureau vivant](#2-phase-1--le-bureau-vivant)
3. [Phase 2 — Les applications essentielles](#3-phase-2--les-applications-essentielles)
4. [Phase 3 — L'intelligence du système](#4-phase-3--lintelligence-du-système)
5. [Phase 4 — L'écosystème complet](#5-phase-4--lécosystème-complet)
6. [Phase 5 — Le polish final](#6-phase-5--le-polish-final)
7. [Dépendances et graphe d'exécution](#7-dépendances-et-graphe-dexécution)
8. [Architecture technique transverse](#8-architecture-technique-transverse)
9. [Métriques de succès](#9-métriques-de-succès)

---

## 1. Principes directeurs

### Philosophie

1. **Incrémental visible** — Chaque étape produit un résultat utilisable et visible. Jamais de travail invisible pendant des semaines.
2. **Desktop-first, pas feature-first** — On construit un bureau, pas une collection d'apps. La cohérence prime sur la quantité.
3. **Natif web, pas émulation** — On ne simule pas Linux dans le navigateur. On exploite les capacités du navigateur (CSS, Canvas, Web APIs) pour recréer l'**expérience** d'un DE.
4. **Le shell est le cœur** — Toutes les améliorations du shell (WM, panel, notifications, thème) bénéficient à toutes les apps. Investir dans le shell d'abord.
5. **Zéro dépendance externe côté frontend** — CSS & JS vanilla/modules natifs. CodeMirror et xterm.js sont les seules exceptions justifiées (des composants spécialisés qu'il serait aberrant de recréer).

### Conventions techniques

```
Frontend :
├── Vanilla JS (ES modules) — pas de framework
├── CSS custom properties pour le theming
├── postMessage pour la communication shell ↔ app
├── localStorage/sessionStorage interdit (utiliser le module state du SDK)
└── Animations via CSS transitions + requestAnimationFrame

Backend :
├── Rust SDK pour toutes les nouvelles apps
├── Commandes = fonctions #[command] retournant des types sérialisables
├── Tout accès filesystem via l'API backend (jamais depuis le frontend)
├── Métriques système via /proc et /sys (Linux)
└── Pas de crate externe non justifiée
```

---

## 2. Phase 1 — Le bureau vivant

> **Objectif** : Le shell custom-shell passe d'un "conteneur de fenêtres" à un vrai bureau.
> **Durée estimée** : 4-6 semaines
> **Prérequis** : Aucun

Cette phase ne touche que `apps/custom-shell/`. Aucune nouvelle app n'est créée.

### Étape 1.1 — Fond d'écran

```
Fichiers modifiés :
├── apps/custom-shell/frontend/desktop.js
├── apps/custom-shell/frontend/index.html
├── apps/custom-shell/backend/   (si Rust: nouveau handler)
└── static/wallpapers/           (nouveau dossier, 10-15 images)

Fonctionnalités :
├── Sélection d'image depuis une galerie intégrée
├── Modes : fill, fit, center
├── Couleur de fallback
├── Persistance via state module
└── Menu contextuel bureau → "Changer le fond d'écran"

Livrable : Le bureau a un fond d'écran par défaut au lieu du noir uni.
```

### Étape 1.2 — Menu contextuel du bureau

```
Fichiers modifiés :
├── apps/custom-shell/frontend/desktop.js

Fonctionnalités :
├── Clic droit sur le bureau → menu contextuel
│   ├── "Fond d'écran..." → ouvre le sélecteur
│   ├── "Ouvrir un terminal" → lance l'app Terminal
│   ├── "Nouveau dossier" (optionnel, prépare l'étape icônes)
│   └── "Paramètres" → lancera l'app Settings (Phase 2)
└── Style cohérent avec les menus existants (titlebar context menu)

Livrable : Le bureau est interactif au clic droit.
```

### Étape 1.3 — Amélioration du panel (Taskbar)

```
Fichiers modifiés :
├── apps/custom-shell/frontend/taskbar.js
├── apps/custom-shell/frontend/styles.css

Fonctionnalités :
├── Icône de l'app à côté du titre dans la liste des fenêtres
├── Indicateur visuel de la fenêtre active (couleur d'accent)
├── Horloge améliorée : HH:MM + date au hover
├── Zone droite réservée pour le system tray (placeholder)
│   └── Affiche pour l'instant : horloge + nom utilisateur
├── Hover sur un bouton fenêtre → tooltip avec le titre complet
└── Animations de transition (apparition/disparition des boutons)

Livrable : Le panel ressemble à un vrai panel de DE.
```

### Étape 1.4 — Window snapping

```
Fichiers modifiés :
├── apps/custom-shell/frontend/window-manager.js

Fonctionnalités :
├── Drag vers le bord gauche → snap 50% gauche
├── Drag vers le bord droit → snap 50% droite
├── Drag vers le haut → maximize
├── Drag vers un coin → snap 25% (quart)
├── Preview overlay semi-transparent pendant le drag
├── Restauration de la taille originale au dé-snap
└── Animations fluides de transition (200ms ease-out)

Livrable : Les fenêtres se snappent comme dans Windows/GNOME.
```

### Étape 1.5 — Amélioration du launcher

```
Fichiers modifiés :
├── apps/custom-shell/frontend/launcher.js

Fonctionnalités :
├── Barre de recherche en haut (filtre instantané par nom)
├── Section "Favoris" (les 5-8 apps les plus utilisées, en haut)
├── Catégories (basées sur le champ category du manifest.toml)
├── Navigation clavier : ↑↓←→ + Enter + Escape
├── Animation d'ouverture (fade-in + scale)
├── Actions en bas : "Verrouiller" + "Se déconnecter"
└── Ouverture via raccourci Super (touche Meta)

Livrable : Le launcher est un vrai launcher, pas une simple grille.
```

### Étape 1.6 — Raccourcis clavier globaux

```
Fichiers modifiés :
├── apps/custom-shell/frontend/keybindings.js (nouveau module)
├── apps/custom-shell/frontend/desktop.js (intégration)

Raccourcis initiaux :
├── Meta → toggle launcher
├── Alt+Tab → cycle les fenêtres (focus next)
├── Alt+F4 → fermer la fenêtre active
├── Super+D → montrer le bureau (minimize tout)
├── Super+←/→ → snap gauche/droite
├── Super+↑ → maximize
├── Super+↓ → restore
└── Ctrl+Alt+T → ouvrir un terminal

Livrable : Le bureau se contrôle au clavier comme un vrai DE.
```

### Étape 1.7 — Alt+Tab Switcher

```
Fichiers modifiés :
├── apps/custom-shell/frontend/switcher.js (nouveau module)

Fonctionnalités :
├── Alt+Tab → affiche un overlay central avec les fenêtres ouvertes
├── Chaque fenêtre : icône + titre (+ screenshot miniature optionnel)
├── Tab successifs pour naviguer, relâcher Alt pour confirmer
├── Affichage en grille (si beaucoup de fenêtres)
├── Highlight de la fenêtre sélectionnée
└── Alt+Shift+Tab → navigation inverse

Livrable : La navigation entre fenêtres est rapide et visuelle.
```

### Étape 1.8 — Animations de fenêtres

```
Fichiers modifiés :
├── apps/custom-shell/frontend/window-manager.js
├── apps/custom-shell/frontend/styles.css

Animations :
├── Ouverture : scale(0.95)→scale(1) + opacity 0→1 (200ms)
├── Fermeture : scale(1)→scale(0.95) + opacity 1→0 (150ms)
├── Maximize : smooth resize vers plein écran (200ms)
├── Snap : smooth resize+move vers la zone cible (200ms)
├── Launcher : fade + blur background (200ms)
└── Option : respect de prefers-reduced-motion

Livrable : Le bureau est fluide et agréable visuellement.
```

### Résumé Phase 1

| # | Étape | Dépend de | Complexité |
|---|-------|-----------|------------|
| 1.1 | Fond d'écran | — | Faible |
| 1.2 | Menu contextuel bureau | — | Faible |
| 1.3 | Panel amélioré | — | Moyenne |
| 1.4 | Window snapping | — | Moyenne |
| 1.5 | Launcher amélioré | — | Moyenne |
| 1.6 | Raccourcis clavier | — | Moyenne |
| 1.7 | Alt+Tab Switcher | 1.6 | Moyenne |
| 1.8 | Animations | — | Faible |

**Résultat de la Phase 1** : Le bureau ZRO ressemble et se comporte comme un vrai DE. Le fond d'écran, le snapping, le launcher avec recherche, les raccourcis clavier et les animations donnent une impression de solidité et de cohérence.

---

## 3. Phase 2 — Les applications essentielles

> **Objectif** : Créer les applications manquantes les plus critiques et améliorer les existantes.
> **Durée estimée** : 8-12 semaines
> **Prérequis** : Phase 1 (au moins 1.1-1.5)

### Étape 2.1 — Application Settings

```
Nouvelle app :
├── apps/settings/manifest.toml
├── apps/settings/backend/     (Rust SDK)
└── apps/settings/frontend/

Pages (par priorité) :
├── Apparence : thème (dark/light), couleur d'accent, fond d'écran
├── Raccourcis clavier : liste éditable (dépend de 1.6)
├── Notifications : DND, position, durée
├── Compte : avatar, nom
├── À propos : version, hostname, uptime
└── (Plus tard : Sécurité, Applications, Affichage)

Backend :
├── get_settings / set_setting
├── get_themes / get_wallpapers
├── get_system_info
└── change_password

Livrable : Un centre de contrôle fonctionnel pour les paramètres essentiels.
```

### Étape 2.2 — System Monitor

```
Nouvelle app :
├── apps/monitor/manifest.toml
├── apps/monitor/backend/     (Rust SDK)
└── apps/monitor/frontend/

Backend (Rust, lecture de /proc) :
├── get_cpu_usage()       → parse /proc/stat
├── get_memory_info()     → parse /proc/meminfo
├── get_disk_usage()      → statvfs
├── get_processes()       → parse /proc/[pid]/stat + status
├── signal_process()      → kill(pid, signal)
├── get_load_average()    → parse /proc/loadavg
├── get_network_stats()   → parse /proc/net/dev
└── get_cpu_temperature() → parse /sys/class/thermal/

Frontend :
├── Vue d'ensemble : 4 jauges (CPU, RAM, Disk, Net)
├── Graphiques temps réel : SVG ou Canvas, buffer 5min
├── Onglet Processus : tableau triable + recherche + kill
├── Rafraîchissement toutes les 2s
└── Responsive (s'adapte à la taille de la fenêtre)

Livrable : On peut monitorer le serveur sans terminal.
```

### Étape 2.3 — System Tray + Quick Settings

```
Fichiers modifiés :
├── apps/custom-shell/frontend/taskbar.js (ajout zone tray)
├── apps/custom-shell/frontend/quick-settings.js (nouveau)
├── apps/custom-shell/backend/ (ajout get_system_info)

System Tray :
├── Icône horloge (existant, déplacé)
├── Icône notifications (badge compteur)
├── Icône utilisateur + mini indicateurs CPU/RAM
└── Clic sur la zone → ouverture du Quick Settings panel

Quick Settings :
├── Nom utilisateur + avatar
├── Toggle dark/light mode
├── Toggle DND (ne pas déranger)
├── Indicateurs : CPU%, RAM%, IP, Uptime
├── Boutons : Paramètres, Verrouiller, Se déconnecter
└── Fermeture par clic extérieur ou Escape

Dépendance : 2.2 (System Monitor) pour les commandes get_cpu_usage etc.
             Ou : le shell implémente ses propres appels système légers.

Livrable : Le panel a un system tray digne de ce nom.
```

### Étape 2.4 — Centre de notifications

```
Fichiers modifiés :
├── apps/custom-shell/frontend/notifications.js (refonte)
├── apps/custom-shell/backend/ (persistance notifications)

Fonctionnalités :
├── Bannières toast améliorées (icône app, titre, corps, actions)
├── Centre de notifications (panel slide-in depuis la droite)
│   ├── Liste chronologique
│   ├── Groupement par app
│   ├── "Tout lire" / "Effacer"
│   └── "Ne pas déranger"
├── Badge compteur dans le tray
├── Persistance (100 dernières, SQLite)
├── API notification enrichie (actions, urgence, timeout)
└── Clic sur notification → focus l'app source

Livrable : Les notifications sont un système complet.
```

### Étape 2.5 — Refonte du File Manager

```
Fichiers modifiés :
├── apps/files/backend/     (nombreuses commandes ajoutées)
├── apps/files/frontend/    (refonte UI)

Backend (ajouts) :
├── copy, move, rename
├── search (récursif)
├── stat (métadonnées complètes)
├── trash, trash_list, trash_restore, trash_empty
├── get_thumbnail (redimensionnement d'image côté serveur — optionnel)
└── write_file (upload)

Frontend :
├── Copier/Couper/Coller (Ctrl+C/X/V) avec presse-papiers interne
├── Renommer (F2, inline editing)
├── Sélection multiple (Ctrl+clic, Shift+clic)
├── Vue icônes + vue liste
├── Barre latérale : Home, Documents, Téléchargements, Corbeille, Favoris
├── Barre d'adresse éditable (clic → champ texte)
├── Recherche (Ctrl+F)
├── Preview amélioré : images (miniature), markdown (rendu HTML)
├── Drag-and-drop pour déplacer/copier des fichiers
├── Boutons Précédent/Suivant
└── Barre d'état (nombre d'éléments, taille totale)

Livrable : Un file manager utilisable au quotidien.
```

### Étape 2.6 — Terminal amélioré

```
Fichiers modifiés :
├── apps/terminal/backend/    (nouvelles commandes)
├── apps/terminal/frontend/   (UI onglets + splits)

Backend :
├── term_create(shell, cwd, env) → nouveau PTY avec config
├── term_list()                  → PTYs actifs
├── term_close(id)               → fermer un PTY
└── get_available_shells()       → shells installés

Frontend :
├── Onglets (tabs) en haut de la fenêtre
├── Ctrl+Shift+T → nouvel onglet
├── Ctrl+Shift+W → fermer l'onglet
├── Indicateur d'activité (onglet arrière-plan)
├── Recherche dans le buffer (Ctrl+Shift+F)
├── Thème terminal héritant du thème global
├── Taille de police configurable
└── Scrollback configurable

Livrable : Terminal avec tabs, praticable pour un usage intensif.
```

### Étape 2.7 — Navigateur web

```
Nouvelle app :
├── apps/browser/manifest.toml
├── apps/browser/backend/     (Rust SDK)
└── apps/browser/frontend/

Backend :
├── get_bookmarks / add_bookmark / remove_bookmark
├── get_history / search_history / clear_history
└── get_homepage_config / set_homepage_config

Frontend :
├── Barre d'adresse + navigation (back/forward/reload)
├── Zone principale = iframe sandboxé
├── Onglets
├── Page d'accueil avec barre de recherche + favoris en grille
├── Gestion des erreurs iframe (détection de blocage X-Frame-Options)
│   └── Bouton "Ouvrir en externe" (window.open)
├── Favoris (étoile dans la barre d'adresse)
└── Historique (consultable, effaçable)

Livrable : Navigation web basique intégrée au bureau.
```

### Étape 2.8 — Écran de verrouillage

```
Fichiers modifiés :
├── apps/custom-shell/frontend/lock-screen.js (nouveau module)
├── apps/custom-shell/backend/ (endpoint verify_password)

Fonctionnalités :
├── Overlay plein écran (z-index maximum)
├── Affiche : horloge, date, nom utilisateur, avatar
├── Champ mot de passe pour déverrouiller
├── Verrouillage : Super+L ou via le launcher/quick settings
├── Auto-lock après X minutes d'inactivité (configurable, défaut: 15min)
├── Fond : flou du bureau (CSS backdrop-filter: blur)
├── 3 échecs → délai progressif (anti brute-force)
└── Les apps continuent de tourner (pas de déconnexion)

Livrable : La session est sécurisable.
```

### Résumé Phase 2

| # | Étape | Dépend de | Complexité |
|---|-------|-----------|------------|
| 2.1 | Settings | Phase 1 | Élevée |
| 2.2 | System Monitor | — | Élevée |
| 2.3 | System Tray + Quick Settings | 2.2 (partiel) | Moyenne |
| 2.4 | Centre de notifications | — | Moyenne |
| 2.5 | File Manager refonte | — | Élevée |
| 2.6 | Terminal amélioré | — | Moyenne |
| 2.7 | Navigateur web | — | Moyenne |
| 2.8 | Écran de verrouillage | — | Moyenne |

**Résultat de la Phase 2** : ZRO dispose de toutes les applications système critiques. L'utilisateur peut naviguer dans ses fichiers, surveiller le système, configurer son bureau, naviguer sur le web, et sécuriser sa session. Le DE est fonctionnel pour un usage quotidien.

---

## 4. Phase 3 — L'intelligence du système

> **Objectif** : Ajouter les services transversaux qui font la différence entre "des apps dans des fenêtres" et "un système intégré".
> **Durée estimée** : 4-6 semaines
> **Prérequis** : Phase 2 (au moins 2.1, 2.4, 2.5)

### Étape 3.1 — Système de thèmes complet

```
Modifications :
├── static/zro-base.css (ajout thèmes : Latte, Nord, Dracula, etc.)
├── apps/custom-shell/frontend/ (theme switcher)
├── apps/settings/frontend/ (page Apparence complète)

Fonctionnalités :
├── 8-10 thèmes prédéfinis (dark + light variants)
├── Couleur d'accent configurable
├── Transition fluide entre thèmes (300ms CSS transitions)
├── Preview en temps réel dans Settings
├── Persistance par utilisateur
└── Le thème s'applique automatiquement à toutes les apps (via CSS vars héritées)

Livrable : Le bureau est personnalisable visuellement.
```

### Étape 3.2 — Presse-papiers inter-applications

```
Modifications :
├── apps/custom-shell/frontend/clipboard-manager.js (nouveau)
├── static/zro-client.js (ajout protocole clipboard)

Architecture :
├── Shell intercepte les événements clipboard (postMessage)
├── zro:clipboard:copy → stocke le contenu + navigator.clipboard
├── zro:clipboard:paste → renvoie le contenu à l'app demandeuse
├── Historique des 50 dernières entrées
├── Ctrl+Shift+V → ouvre le panel historique clipboard
├── Types : texte, HTML, image (base64)
└── Le module clipboard du SDK est branché sur ce système

Livrable : Copier-coller entre apps fonctionne.
```

### Étape 3.3 — Associations MIME / "Ouvrir avec"

```
Modifications :
├── protocol/src/manifest.rs (ajout champ mime_types dans Manifest)
├── runtime/src/registry.rs (index MIME → app)
├── apps/custom-shell/frontend/ (routing "open file with app")
├── apps/files/frontend/ (double-clic → ouvrir avec app associée)

Fonctionnalités :
├── manifest.toml : nouveau champ `mime_types = ["text/*", "image/png"]`
├── Le registry construit un index type → app au démarrage
├── Double-clic fichier dans Files → message au shell → ouvre l'app associée
├── Clic droit → "Ouvrir avec..." → liste des apps compatibles
├── Configuration des associations par défaut dans Settings
└── L'app reçoit le chemin du fichier dans ses paramètres de lancement

Livrable : Les fichiers s'ouvrent avec la bonne application.
```

### Étape 3.4 — Espaces de travail virtuels

```
Modifications :
├── apps/custom-shell/frontend/workspaces.js (nouveau module)
├── apps/custom-shell/frontend/window-manager.js (workspace awareness)
├── apps/custom-shell/frontend/taskbar.js (indicateur workspace)

Fonctionnalités :
├── 4 workspaces par défaut
├── Indicateur dans le panel (pastilles ou numéros)
├── Navigation : Ctrl+Alt+←/→ ou Super+scroll
├── Déplacement de fenêtre : Super+Shift+←/→
├── Animation slide horizontal entre workspaces
├── Chaque workspace a ses propres fenêtres
├── Fenêtre sticky (visible sur tous les workspaces)
└── Persistance de l'assignation fenêtre-workspace

Livrable : Organisation multi-bureau, comme GNOME Activities.
```

### Résumé Phase 3

| # | Étape | Dépend de | Complexité |
|---|-------|-----------|------------|
| 3.1 | Thèmes complets | Phase 1, 2.1 | Moyenne |
| 3.2 | Clipboard inter-app | — | Moyenne |
| 3.3 | Associations MIME | 2.5 (Files refonte) | Moyenne |
| 3.4 | Espaces de travail | Phase 1 (WM) | Élevée |

**Résultat de la Phase 3** : Le système est intégré. Les apps communiquent via le clipboard, les fichiers s'ouvrent avec la bonne app, le bureau est organisable en workspaces, et le thème est personnalisable.

---

## 5. Phase 4 — L'écosystème complet

> **Objectif** : Ajouter les applications secondaires qui enrichissent le bureau.
> **Durée estimée** : 6-8 semaines
> **Prérequis** : Phase 2-3

### Étape 4.1 — Calculatrice

```
Nouvelle app :
├── apps/calculator/manifest.toml
├── apps/calculator/frontend/ (100% frontend, pas de backend)

Modes : basique, scientifique, programmeur
Priorité : Faible complexité, grande valeur perçue.
```

### Étape 4.2 — Text Editor (refonte Notes)

```
Refonte de l'app existante :
├── apps/notes/ → enrichi avec CodeMirror 6

Fonctionnalités :
├── CodeMirror 6 comme composant d'édition
├── Coloration syntaxique (200+ langages)
├── Onglets multiples
├── Ouverture de fichiers arbitraites (via MIME ou "Ouvrir avec")
├── Mode Notes rapides (panel latéral, comme l'actuel)
├── Aperçu Markdown (split view)
├── Recherche et remplacement
├── Barre d'état (ligne, colonne, encodage, langage)
└── Backend : ajout write_file, get_file_info
```

### Étape 4.3 — Visionneuse d'images

```
Nouvelle app :
├── apps/image-viewer/manifest.toml
├── apps/image-viewer/backend/    (Rust SDK)
├── apps/image-viewer/frontend/

Fonctionnalités :
├── Affichage de tous les formats web (JPEG, PNG, GIF, WebP, SVG)
├── Zoom (molette + boutons), pan, rotation
├── Navigation dans le dossier (←/→)
├── Filmstrip de miniatures
├── Infos : dimensions, taille, EXIF
├── Diaporama automatique
└── Actions : définir comme fond d'écran, copier, supprimer
```

### Étape 4.4 — Capture d'écran

```
Nouvelle micro-app :
├── apps/screenshot/ (mini-app, surtout frontend)

Fonctionnalités :
├── PrtSc → capture plein écran → notification instantanée
├── Super+Shift+S → sélection de zone (rectangle sur overlay)
├── Annotation basique (flèches, rectangles, texte)
├── Copier / Sauvegarder
└── Utilise html2canvas ou getDisplayMedia
```

### Étape 4.5 — Caméra

```
Nouvelle app :
├── apps/camera/manifest.toml
├── apps/camera/backend/    (endpoint upload)
├── apps/camera/frontend/

100% basé sur getUserMedia du navigateur.
Photo + Vidéo + Filtres CSS + Sauvegarde sur serveur.
```

### Étape 4.6 — Lecteur multimédia

```
Nouvelle app :
├── apps/media-player/manifest.toml
├── apps/media-player/backend/    (streaming, métadonnées)
├── apps/media-player/frontend/

Vidéo : balise <video>, contrôles personnalisés, plein écran, sous-titres.
Audio : player stylé, playlist, pochette d'album, shuffle/repeat.
Note : Dépend du streaming HTTP du backend pour servir les fichiers.
```

### Étape 4.7 — Calendrier

```
Nouvelle app :
├── apps/calendar/manifest.toml
├── apps/calendar/backend/    (Rust SDK, CRUD événements, SQLite)
├── apps/calendar/frontend/

Vues : mois, semaine, jour.
Événements avec récurrence, rappels, couleurs.
Intégration avec le widget horloge du panel.
```

### Étape 4.8 — Horloge

```
Nouvelle app :
├── apps/clock/manifest.toml
├── apps/clock/frontend/ (principalement frontend)

Horloge mondiale, alarmes, minuteur, chronomètre.
Les alarmes déclenchent des notifications via le système global.
```

### Étape 4.9 — Tasks amélioré

```
Amélioration app existante :
├── apps/tasks/frontend/ (ajout drag-drop, sous-tâches)
├── apps/tasks/backend/  (ajout subtasks, attachments)

Drag-and-drop entre colonnes (utilise l'API HTML5 Drag).
Sous-tâches (checklist).
Vues alternatives : liste, calendrier.
Colonnes personnalisables.
```

### Résumé Phase 4

| # | Étape | Complexité |
|---|-------|------------|
| 4.1 | Calculatrice | Faible |
| 4.2 | Text Editor (CodeMirror) | Élevée |
| 4.3 | Visionneuse d'images | Moyenne |
| 4.4 | Capture d'écran | Moyenne |
| 4.5 | Caméra | Moyenne |
| 4.6 | Lecteur multimédia | Moyenne |
| 4.7 | Calendrier | Élevée |
| 4.8 | Horloge | Faible |
| 4.9 | Tasks amélioré | Moyenne |

À ce stade, toutes les apps de l'écosystème sont en place.

---

## 6. Phase 5 — Le polish final

> **Objectif** : Finitions, cohérence, edge cases, accessibilité.
> **Durée estimée** : 4-6 semaines
> **Prérequis** : Phase 1-4

### Étape 5.1 — Icônes de bureau

```
Placement libre d'icônes (raccourcis fichiers/apps) sur le desktop.
Grille de snap optionnelle.
Double-clic pour ouvrir.
Clic droit pour les actions.
```

### Étape 5.2 — Drag-and-drop inter-applications

```
Le shell sert de relais pour le DnD entre iframes.
Protocole postMessage : zro:dnd:start, zro:dnd:enter, zro:dnd:drop.
Cas d'usage : fichier → terminal, texte → notes, URL → bureau.
```

### Étape 5.3 — Centre logiciel

```
Interface graphique sur le registry et le hot reload existants.
Liste des apps installées, état, logs.
Installer/supprimer/mettre à jour.
```

### Étape 5.4 — Accessibilité

```
Audit WCAG AA complet.
Navigation clavier sur tous les composants.
Rôles ARIA.
Focus visible.
prefers-reduced-motion.
High contrast mode.
```

### Étape 5.5 — Performance et polish

```
Audit des performances (profiling renderer).
Lazy loading des apps.
Optimisation mémoire (limiter les iframes inactives).
Animations sur GPU (transform/opacity uniquement).
Tests e2e de tous les workflows.
```

---

## 7. Dépendances et graphe d'exécution

```
                           ┌──────────────┐
                           │   Phase 1    │
                           │  Bureau      │
                           │  vivant      │
                           └──────┬───────┘
                                  │
                    ┌─────────────┼─────────────┐
                    ▼             ▼             ▼
              ┌──────────┐ ┌──────────┐ ┌──────────┐
              │  2.1-2.4 │ │  2.5-2.6 │ │  2.7-2.8 │
              │ Settings │ │ Files &  │ │ Browser &│
              │ Monitor  │ │ Terminal │ │ Lock     │
              │ Tray     │ │          │ │ Screen   │
              │ Notifs   │ │          │ │          │
              └────┬─────┘ └────┬─────┘ └────┬─────┘
                   │            │             │
                   └─────────┬──┘─────────────┘
                             ▼
                    ┌──────────────┐
                    │   Phase 3    │
                    │ Intégration  │
                    │ Thèmes,MIME, │
                    │ Clipboard,WS │
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │   Phase 4    │
                    │ Applications │
                    │ secondaires  │
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │   Phase 5    │
                    │  Polish &    │
                    │  finitions   │
                    └──────────────┘
```

### Parallélisation possible

Au sein de chaque phase, beaucoup d'étapes sont indépendantes :

**Phase 1** : Les étapes 1.1 à 1.6 sont toutes indépendantes. 1.7 dépend de 1.6. 1.8 est indépendant.

**Phase 2** : 
- Branche A : 2.1 (Settings) → 2.3 (Tray)
- Branche B : 2.2 (Monitor, indépendant)
- Branche C : 2.4 (Notifications, indépendant)
- Branche D : 2.5 (Files, indépendant) + 2.6 (Terminal, indépendant)
- Branche E : 2.7 (Browser, indépendant) + 2.8 (Lock screen, indépendant)

**Phase 4** : Toutes les apps sont indépendantes les unes des autres.

---

## 8. Architecture technique transverse

### Modification du manifest.toml

Le manifeste de chaque app doit être enrichi pour supporter l'écosystème :

```toml
[app]
name = "files"
display_name = "Fichiers"
version = "2.0.0"
description = "Gestionnaire de fichiers"
icon = "📁"                          # Emoji ou chemin vers une icône
category = "system"                  # system | tools | internet | multimedia | productivity
mime_types = ["inode/directory"]     # Types MIME supportés
keywords = ["fichier", "dossier", "explorer", "naviguer"]  # Pour la recherche

[app.window]
default_width = 900
default_height = 600
min_width = 400
min_height = 300
resizable = true
```

### Nouveau module SDK frontend : `desktop`

```javascript
// Enrichissement du SDK pour les interactions desktop
conn.desktop = {
  // Demander au shell d'ouvrir un fichier avec l'app associée
  openFile(path) { ... },
  
  // Demander au shell d'ouvrir une URL
  openUrl(url) { ... },
  
  // Demander au shell la liste des fonds d'écran
  getWallpapers() { ... },
  
  // Définir le fond d'écran
  setWallpaper(path) { ... },
  
  // Obtenir les infos système (pour le tray/quick settings)
  getSystemInfo() { ... },
};
```

### Storage : SQLite pour les données app

Chaque app qui a besoin de stockage structuré (calendrier, bookmarks, historique) utilise SQLite via le backend. Le runtime fournit déjà un mécanisme de storage par app dans `runtime/src/storage/`.

### Icônes des applications

Plutôt que des fichiers image, utiliser des émojis Unicode ou des SVG inline stockés dans le manifeste. Cela évite la gestion d'assets et reste léger :

```
📁 Files    🖥 Terminal    📝 Notes     ✅ Tasks
⚙️ Settings  📊 Monitor   🧮 Calculator  📷 Camera
🌐 Browser  🖼 Images    🎬 Media      📅 Calendar
🕐 Clock    📸 Screenshot  🛒 Software  🔒 Lock
```

---

## 9. Métriques de succès

### Phase 1 — Bureau vivant
- [ ] Le bureau a un fond d'écran changeable
- [ ] Le clic droit sur le bureau ouvre un menu contextuel
- [ ] Les fenêtres se snappent sur les bords (gauche, droite, maximize)
- [ ] Le launcher a une barre de recherche fonctionnelle
- [ ] Alt+Tab fonctionne pour switcher entre fenêtres
- [ ] Au moins 8 raccourcis clavier sont opérationnels
- [ ] Les animations de fenêtre sont fluides (>30fps)

### Phase 2 — Applications essentielles
- [ ] L'app Settings permet de changer le thème et le fond d'écran
- [ ] Le System Monitor affiche CPU et RAM en temps réel
- [ ] Le System Tray affiche au moins 3 indicateurs
- [ ] Le Centre de notifications supporte les actions et le DND
- [ ] Le File Manager supporte copier/coller/renommer/rechercher
- [ ] Le Terminal supporte les onglets
- [ ] Le navigateur charge et affiche des sites web via iframe
- [ ] L'écran de verrouillage protège la session

### Phase 3 — Intelligence système
- [ ] Au moins 5 thèmes sont disponibles (dark + light)
- [ ] Le copier-coller fonctionne entre 2 apps différentes
- [ ] Un double-clic sur un .txt ouvre l'éditeur, un .png ouvre le viewer
- [ ] Les workspaces virtuels fonctionnent (au moins 2)

### Phase 4 — Écosystème complet
- [ ] Au moins 15 apps sont disponibles dans le launcher
- [ ] Chaque catégorie (Système, Outils, Internet, Multimédia, Productivité) a au moins 2 apps

### Phase 5 — Polish
- [ ] Navigation clavier complète dans le shell
- [ ] Score WCAG AA sur les contrastes
- [ ] Temps de chargement initial < 3s
- [ ] Utilisation mémoire < 200MB avec 5 apps ouvertes
