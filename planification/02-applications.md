# ZRO — Applications : Catalogue complet

> Document de planification — Mars 2026
> Objectif : Détailler chaque application indispensable d'un environnement de bureau complet, avec ses fonctionnalités, son UI, et son état dans ZRO.

---

## Table des matières

1. [Vue d'ensemble du catalogue](#1-vue-densemble-du-catalogue)
2. [Paramètres (Settings)](#2-paramètres-settings)
3. [Terminal](#3-terminal)
4. [Gestionnaire de fichiers (Files)](#4-gestionnaire-de-fichiers-files)
5. [Calculatrice (Calculator)](#5-calculatrice-calculator)
6. [Moniteur système (System Monitor)](#6-moniteur-système-system-monitor)
7. [Caméra / Webcam](#7-caméra--webcam)
8. [Navigateur web (Web Browser)](#8-navigateur-web-web-browser)
9. [Éditeur de texte (Notes / Text Editor)](#9-éditeur-de-texte-notes--text-editor)
10. [Visionneuse d'images (Image Viewer)](#10-visionneuse-dimages-image-viewer)
11. [Capture d'écran (Screenshot)](#11-capture-décran-screenshot)
12. [Lecteur multimédia (Media Player)](#12-lecteur-multimédia-media-player)
13. [Calendrier (Calendar)](#13-calendrier-calendar)
14. [Gestionnaire de tâches (Tasks)](#14-gestionnaire-de-tâches-tasks)
15. [Horloge / Minuteur (Clock)](#15-horloge--minuteur-clock)
16. [Centre logiciel (Software Center)](#16-centre-logiciel-software-center)

---

## 1. Vue d'ensemble du catalogue

### Classification par état

| App | Catégorie | Existe | État | Action |
|-----|----------|--------|------|--------|
| Settings | Système | ❌ | — | Créer |
| Terminal | Système | ✅ | Fonctionnel | Améliorer |
| Files | Système | ✅ | Basique | Améliorer fortement |
| Calculator | Outils | ❌ | — | Créer |
| System Monitor | Système | ❌ | — | Créer |
| Camera | Multimédia | ❌ | — | Créer |
| Web Browser | Internet | ❌ | — | Créer |
| Text Editor / Notes | Outils | ✅ | Basique | Améliorer fortement |
| Image Viewer | Multimédia | ❌ | — | Créer |
| Screenshot | Outils | ❌ | — | Créer |
| Media Player | Multimédia | ❌ | — | Créer |
| Calendar | Productivité | ❌ | — | Créer |
| Tasks | Productivité | ✅ | Fonctionnel | Améliorer |
| Clock | Outils | ❌ | — | Créer |
| Software Center | Système | ❌ | — | Créer |

### Comparaison avec les DE existants

| App | GNOME | KDE | XFCE | macOS | ZRO cible |
|-----|-------|-----|------|-------|-----------|
| Settings | Paramètres GNOME | System Settings | XFCE Settings | Préférences Système | ✅ |
| Terminal | Console/Terminal | Konsole | xfce4-terminal | Terminal.app | ✅ |
| Files | Nautilus | Dolphin | Thunar | Finder | ✅ |
| Calculator | Calculator | KCalc | — | Calculator | ✅ |
| Monitor | System Monitor | KSysGuard | Task Manager | Activity Monitor | ✅ |
| Camera | Cheese | Kamoso | — | FaceTime | ✅ |
| Browser | Epiphany | Falkon | — | Safari | ✅ (iframe) |
| Editor | Text Editor | Kate | Mousepad | TextEdit | ✅ |
| Images | Eye of GNOME | Gwenview | Ristretto | Preview | ✅ |
| Screenshot | Screenshot | Spectacle | xfce4-screenshooter | Screenshot.app | ✅ |
| Media | Videos / Music | Elisa / Dragon | Parole | QuickTime | ✅ |
| Calendar | Calendar | KOrganizer | orage | Calendar | ✅ |
| Tasks | Endeavour | — | — | Reminders | ✅ |
| Clock | Clocks | KClock | orage | Clock | ✅ |
| Software | Software | Discover | — | App Store | ✅ |

---

## 2. Paramètres (Settings)

> **État : ❌ À créer**
> **Priorité : 🔴 Critique** — C'est le point d'entrée pour toute la personnalisation du DE
> **Catégorie : Système**

### Description
L'application Settings est le centre de contrôle de tout l'environnement. Elle permet de personnaliser chaque aspect du bureau, du thème aux raccourcis clavier. C'est l'équivalent des Préférences Système de macOS ou des Paramètres GNOME.

### Structure de l'UI

```
┌───────────────────────────────────────────────────────┐
│  ⚙️ Paramètres                          [🔍 Recherche]│
│  ─────────────────────────────────────────────────────│
│  │                         │                          │
│  │  Apparence              │  ▶ Apparence             │
│  │  ───────────            │                          │
│  │  🎨 Thème               │  Thème                   │
│  │  🖼 Fond d'écran        │  ┌──────┐ ┌──────┐      │
│  │  🔤 Polices             │  │Mocha │ │Latte │ ...  │
│  │                         │  └──────┘ └──────┘      │
│  │  Système                │                          │
│  │  ───────────            │  Couleur d'accent        │
│  │  🔔 Notifications       │  ● ● ● ● ● ● ●         │
│  │  ⌨️ Raccourcis           │  bleu lavande mauve ...  │
│  │  🖥 Affichage           │                          │
│  │  🔒 Sécurité            │  Densité                 │
│  │  👤 Compte              │  ○ Compact ● Normal ○ Sp │
│  │                         │                          │
│  │  Applications           │  Rayon des bordures      │
│  │  ───────────            │  ○ Sharp ● Normal ○ Pill │
│  │  📁 Fichiers            │                          │
│  │  🖥 Terminal             │  Fond d'écran            │
│  │  📋 Par défaut          │  [Image actuelle]        │
│  │                         │  [Changer...]            │
│  └─────────────────────────┘                          │
└───────────────────────────────────────────────────────┘
```

### Pages de paramètres détaillées

#### 2.1 — Apparence

```
Thème :
├── Sélecteur visuel avec preview (miniatures des thèmes)
├── Thèmes : Catppuccin Mocha, Catppuccin Latte, Nord, Dracula, Tokyo Night,
│   Gruvbox, Solarized Dark, Solarized Light, One Dark
├── Preview en temps réel (le thème s'applique immédiatement)
└── Import de thème personnalisé (fichier CSS)

Couleur d'accent :
├── Palette de couleurs prédéfinies
├── Color picker personnalisé (hex/rgb)
└── La couleur d'accent teinte les boutons, sélections, liens, focus

Fond d'écran :
├── Galerie de fonds intégrés (miniatures cliquables)
├── Upload d'image personnalisée (drag-drop ou file picker)
├── Mode d'affichage : Fill, Fit, Stretch, Center, Tile
├── Couleur unie / Dégradé comme alternative
└── Diaporama (sélection de dossier + intervalle)

Polices :
├── Police principale (UI) : sélecteur parmi les polices disponibles
├── Police monospace (terminal, code) : idem
├── Taille de base (12-20px, slider)
└── Upload de fonte personnalisée (fichiers .woff2)

Densité de l'UI :
├── Compact : padding réduit, éléments plus petits
├── Normal : valeur par défaut
└── Spacieux : padding augmenté

Rayon des bordures :
├── Sharp (0px) : angles droits
├── Normal (8px) : arrondi subtil
└── Pill (16-24px) : très arrondi, style moderne
```

#### 2.2 — Notifications

```
Paramètres de notification :
├── Ne pas déranger : toggle + horaires automatiques
├── Position des bannières : haut-droite / haut-centre / bas-droite
├── Durée des bannières : 3s / 5s / 10s / persistent
├── Son de notification : on/off + sélection du son
├── Par application :
│   ├── Activer/désactiver les notifications
│   ├── Bannières uniquement / centre uniquement / les deux
│   └── Son on/off
└── Historique : durée de rétention (1 jour / 1 semaine / 1 mois)
```

#### 2.3 — Raccourcis clavier

```
Configuration des raccourcis :
├── Liste de toutes les actions avec leur raccourci actuel
├── Clic sur un raccourci → capture la prochaine combinaison
├── Détection de conflits (avertissement si déjà utilisé)
├── Reset aux valeurs par défaut
├── Catégories : Navigation, Fenêtres, Applications, Système
└── Import/Export de profil de raccourcis
```

#### 2.4 — Affichage

```
Paramètres d'affichage :
├── Résolution : info lecture seule (taille du viewport navigateur)
├── Mise à l'échelle : 100% / 125% / 150% / 200% (CSS zoom)
├── Fréquence de rafraîchissement des indicateurs système
├── Animations : on / réduites / off
└── Mode plein écran : info + bouton pour basculer (F11)
```

#### 2.5 — Sécurité

```
Paramètres de sécurité :
├── Écran de verrouillage :
│   ├── Délai d'inactivité : 1min / 5min / 15min / 30min / jamais
│   ├── Fond du lock screen : identique au bureau / image séparée / flou
│   └── Message personnalisé sur le lock screen
├── Session :
│   ├── Durée de validité du JWT : info lecture seule
│   └── Sessions actives : liste + bouton "déconnecter"
└── Changer le mot de passe
```

#### 2.6 — Compte utilisateur

```
Paramètres du compte :
├── Avatar : upload d'image ou sélection d'un emoji
├── Nom d'affichage
├── Email (si applicable)
├── Langue de l'interface (i18n)
└── Fuseau horaire
```

#### 2.7 — Applications (associations par défaut)

```
Applications par défaut :
├── Navigateur web : [sélecteur parmi les apps compatibles]
├── Éditeur de texte : idem
├── Lecteur d'images : idem
├── Lecteur vidéo : idem
├── Lecteur audio : idem
├── Terminal : idem
└── Gestionnaire de fichiers : idem

Associations MIME :
├── Liste des types de fichiers connus
├── App associée pour chacun
├── Modifier l'association au clic
└── Reset aux valeurs par défaut
```

#### 2.8 — À propos

```
À propos :
├── Nom du système : ZRO Desktop Environment
├── Version runtime
├── Version du shell
├── Hostname du serveur
├── OS du serveur (Linux, kernel version)
├── Architecture (x86_64, aarch64)
├── Uptime du service
├── Nombre d'apps installées
├── Nombre d'utilisateurs
└── Licences open source
```

### Backend (Rust)

```
Commandes :
├── get_settings()           → toutes les préférences utilisateur
├── set_setting(key, value)  → modifier une préférence
├── get_themes()             → liste des thèmes disponibles
├── get_wallpapers()         → liste des fonds d'écran
├── upload_wallpaper(data)   → uploader un fond personnalisé
├── get_system_info()        → infos système (hostname, OS, uptime, etc.)
├── get_sessions()           → sessions actives de l'utilisateur
├── revoke_session(id)       → déconnecter une session
├── change_password(old,new) → changer le mdp
└── get_mime_associations()  → associations MIME actuelles
```

---

## 3. Terminal

> **État : ✅ Existe, à améliorer**
> **Priorité : 🔶 Amélioration**
> **Catégorie : Système**

### Existant
- PTY réel via `portable_pty`
- xterm.js avec fit + weblinks addons
- Reconnexion automatique (5s grace)
- Sessions isolées par instance

### Améliorations nécessaires

#### 3.1 — Onglets et splits

```
┌───────────────────────────────────────────────────────┐
│  [bash] [python] [htop]  [+]                     [≡] │
│  ─────────────────────────────────────────────────────│
│  ┌──────────────────────┐┌──────────────────────────┐ │
│  │ $ cargo build        ││ $ python3                │ │
│  │   Compiling zro...   ││ >>> import os            │ │
│  │                      ││ >>> os.getcwd()          │ │
│  │                      ││ '/home/dev'              │ │
│  └──────────────────────┘└──────────────────────────┘ │
└───────────────────────────────────────────────────────┘
```

```
Onglets :
├── Plusieurs onglets dans une seule fenêtre
├── Chaque onglet = un PTY indépendant
├── Réorganisation par drag-and-drop
├── Renommage d'onglet (double-clic)
├── Fermeture avec bouton × ou Ctrl+Shift+W
├── Raccourci Ctrl+Shift+T pour nouvel onglet
└── Indicateur d'activité sur les onglets en arrière-plan

Splits (panneaux divisés) :
├── Diviser horizontalement : Ctrl+Shift+H
├── Diviser verticalement : Ctrl+Shift+V
├── Redimensionner les panneaux par drag du séparateur
├── Naviguer entre panneaux : Alt+↑↓←→
└── Fermer un panneau : Ctrl+Shift+W
```

#### 3.2 — Sélection du shell

```
Shells disponibles :
├── /bin/bash (défaut)
├── /bin/zsh
├── /bin/sh
├── /usr/bin/fish
└── Personnalisé (chemin configurable dans Settings)

Profils :
├── Profils nommés (ex: "Dev", "Root", "Python REPL")
├── Chaque profil : shell + env vars + répertoire initial
└── Sélection du profil à l'ouverture d'un onglet
```

#### 3.3 — Améliorations UX

```
Copier/Coller :
├── Ctrl+Shift+C / Ctrl+Shift+V (standard terminal)
├── Sélection → copie automatique (mode mouse)
├── Intégration avec le clipboard manager du shell
└── Coller avec clic milieu (si souris 3 boutons)

Recherche :
├── Ctrl+Shift+F → barre de recherche dans le buffer
├── Highlight des correspondances
├── Navigation ↑↓ entre les résultats
└── Regex optionnel

Thème du terminal :
├── Hérite du thème global (couleurs mappées)
├── Override possible (palette 16 couleurs configurable)
├── Taille de police indépendante
├── Curseur : block / underline / bar + clignotement
└── Transparence de fond optionnelle

Divers :
├── Scrollback configurable (1000 / 5000 / 10000 / illimité)
├── Titre dynamique (basé sur la commande en cours)
├── Bell : sonore / visuelle / désactivée
├── Ligature de polices (si JetBrains Mono)
├── Hyperliens cliquables (existant via weblinks addon)
└── Notification quand une commande longue se termine (si onglet en arrière-plan)
```

### Backend

```
Commandes existantes :
├── term_input(data)    → envoyer des données au PTY
├── term_resize(cols, rows) → redimensionner le PTY

Nouvelles commandes nécessaires :
├── term_create(shell, cwd, env)  → créer un nouveau PTY avec config
├── term_list()                   → lister les PTY actifs
├── term_close(id)                → fermer un PTY
├── get_available_shells()        → lister les shells installés
└── get_terminal_profiles()       → profils sauvegardés
```

---

## 4. Gestionnaire de fichiers (Files)

> **État : ✅ Existe, à améliorer fortement**
> **Priorité : 🔴 Critique**
> **Catégorie : Système**

### Existant
- Navigation de répertoires (ls)
- Lecture de fichiers texte (read_file)
- Création dossier (mkdir) et fichier (touch)
- Suppression (rm)
- Breadcrumb navigation
- Tableau fichiers (icône, nom, taille, date)
- Panel de preview (texte)
- Menu contextuel (clic droit)
- Protection path traversal

### Améliorations nécessaires

#### 4.1 — Opérations sur les fichiers

```
Opérations manquantes CRITIQUES :
├── Copier (Ctrl+C)
│   └── Sélectionner fichier(s) → Copier → Naviguer → Coller
├── Couper (Ctrl+X)
│   └── Idem mais supprime la source après le collage
├── Coller (Ctrl+V)
│   └── Détermine la destination (dossier courant)
├── Renommer (F2)
│   └── Inline editing du nom de fichier
├── Déplacer (drag-and-drop vers un dossier)
│   └── Visual feedback pendant le drag
├── Duplicate
│   └── Créer une copie avec suffixe "(1)"
├── Compresser / Décompresser
│   ├── .zip, .tar.gz, .tar.bz2
│   └── Extraction dans un dossier ou sur place
└── Propriétés (info panneau)
    ├── Taille
    ├── Permissions (chmod)
    ├── Propriétaire
    ├── Date création / modification / accès
    └── Type MIME
```

#### 4.2 — Sélection et navigation

```
Sélection multiple :
├── Clic + Ctrl → sélection multiple non contiguë
├── Clic + Shift → sélection de plage
├── Rectangle de sélection (rubber band) en mode icônes
├── Ctrl+A → tout sélectionner
└── Barre d'état : "X éléments sélectionnés (Y MB)"

Vues :
├── Liste (actuel, avec colonnes triables)
├── Icônes (grille de miniatures)
├── Arborescence (tree view type explorateur VS Code)
└── Colonnes (style macOS Finder)

Navigation :
├── Breadcrumb (existant ✅)
├── Barre d'adresse éditable (clic sur le breadcrumb → champ texte)
├── Boutons Précédent / Suivant (historique de navigation)
├── Raccourcis latéraux :
│   ├── 🏠 Home
│   ├── 📄 Documents
│   ├── 📥 Téléchargements
│   ├── 🖼 Images
│   ├── 🎵 Musique
│   ├── 🗑 Corbeille
│   └── ⭐ Favoris (dossiers épinglés)
├── Onglets (plusieurs emplacements dans une même fenêtre)
└── Double-panneau optionnel (split view)
```

#### 4.3 — Recherche

```
Recherche :
├── Barre de recherche (Ctrl+F)
├── Recherche récursive dans le dossier courant
├── Filtrage par nom, type, taille, date
├── Résultats en temps réel (debounced, 300ms)
├── Expressions régulières optionnelles
└── Recherche dans le contenu des fichiers (grep)
```

#### 4.4 — Preview et ouverture

```
Preview amélioré :
├── Texte : highlight syntaxique (basé sur l'extension)
├── Images : miniature + info (dimensions, taille, format)
├── Vidéo : player intégré (balise <video>)
├── Audio : player intégré (balise <audio>)
├── PDF : viewer intégré (PDF.js ou iframe)
├── Markdown : rendu HTML
├── CSV/TSV : tableau formaté
└── Code source : coloration syntaxique (highlight.js ou prism)

Double-clic :
├── Fichier → ouvrir avec l'app associée (MIME)
├── Dossier → naviguer dedans
└── Exécutable → demander confirmation → ouvrir dans Terminal
```

#### 4.5 — Corbeille

```
Corbeille (Trash) :
├── Suppression → déplace vers ~/.local/share/Trash/ (standard FreeDesktop)
├── Accessible depuis le panneau latéral
├── Restaurer un fichier → retour à l'emplacement d'origine
├── Vider la corbeille → suppression définitive
├── Taille de la corbeille affichée
└── Suppression définitive : Shift+Delete (avec confirmation)
```

#### 4.6 — Drag and Drop

```
Drag & Drop :
├── Drag fichier vers un dossier → déplacer
├── Drag + Ctrl vers un dossier → copier
├── Drag vers la barre latérale → ajouter aux favoris
├── Drag vers le bureau → créer un raccourci
├── Drag vers une autre app (Terminal, Notes...) → ouvrir/insérer
├── Drag depuis l'OS hôte → upload dans le dossier courant
└── Visual feedback : icône fantôme + indicateur d'action (➕ copier, ➡ déplacer)
```

### Backend

```
Commandes existantes :
├── ls(path)
├── read_file(path)
├── mkdir(path)
├── touch(path)
└── rm(path)

Nouvelles commandes nécessaires :
├── copy(src, dst)         → copier fichier/dossier
├── move(src, dst)         → déplacer/renommer
├── rename(path, new_name) → renommer
├── stat(path)             → métadonnées complètes
├── search(path, query)    → recherche récursive
├── compress(paths, fmt)   → créer une archive
├── extract(path, dst)     → extraire une archive
├── trash(path)            → déplacer vers la corbeille
├── trash_list()           → lister la corbeille
├── trash_restore(id)      → restaurer de la corbeille
├── trash_empty()          → vider la corbeille
├── chmod(path, mode)      → changer les permissions
├── get_favorites()        → dossiers favoris
├── set_favorites(paths)   → définir les favoris
├── read_file_range(path, offset, len) → lecture partielle (gros fichiers)
├── get_thumbnail(path)    → miniature d'image (redimensionnée côté serveur)
└── write_file(path, data) → écriture de fichier (upload)
```

---

## 5. Calculatrice (Calculator)

> **État : ❌ À créer**
> **Priorité : 🟡 Important**
> **Catégorie : Outils**

### Description
Application de calcul avec modes basique, scientifique, et programmeur. Équivalent de GNOME Calculator ou KCalc.

### UI

```
Mode basique :
┌─────────────────────────────┐
│  Calculatrice          ≡    │
│  ─────────────────────────  │
│                             │
│           123,456.78   │    │
│  ───────────────────────    │
│  [MC] [MR] [M+] [M-] [MS] │
│  [ % ] [ CE] [ C ] [ ⌫ ]  │
│  [ ⅟x] [ x²] [ √ ] [ ÷ ] │
│  [ 7 ] [ 8 ] [ 9 ] [ × ]  │
│  [ 4 ] [ 5 ] [ 6 ] [ - ]  │
│  [ 1 ] [ 2 ] [ 3 ] [ + ]  │
│  [ ±  ] [ 0 ] [ . ] [ = ]  │
└─────────────────────────────┘
```

### Fonctionnalités

```
Mode basique :
├── Opérations : +, -, ×, ÷
├── Pourcentage
├── Mémoire (MC, MR, M+, M-, MS)
├── Historique des calculs (scrollable)
├── Copier le résultat (clic sur le nombre)
└── Entrée clavier complète (numpad + opérateurs)

Mode scientifique :
├── Trigonométrie : sin, cos, tan, asin, acos, atan
├── Logarithmes : log, ln, log₂
├── Puissances : xⁿ, eˣ, 10ˣ
├── Factorielle
├── Constantes : π, e, φ
├── Parenthèses
├── Degrés / Radians toggle
└── Notation scientifique

Mode programmeur :
├── Bases : DEC, HEX, OCT, BIN
├── Opérations bit : AND, OR, XOR, NOT, SHIFT
├── Taille : 8/16/32/64 bits
├── Conversion entre bases en temps réel
├── Affichage simultané dans toutes les bases
└── Signed / Unsigned

Mode conversion :
├── Longueur (m, km, mi, ft, in)
├── Poids (kg, g, lb, oz)
├── Température (°C, °F, K)
├── Vitesse (km/h, m/s, mph)
├── Données (B, KB, MB, GB, TB)
├── Temps (s, min, h, j)
└── Devises (via API externe optionnelle)
```

### Implémentation
- **100% frontend** — pas besoin de backend
- Les calculs se font en JavaScript avec `BigNumber.js` ou similaire pour la précision
- L'historique peut être persisté via le module `state` du SDK
- Mode de conversion peut être extensible

---

## 6. Moniteur système (System Monitor)

> **État : ❌ À créer**
> **Priorité : 🔴 Critique**
> **Catégorie : Système**

### Description
Équivalent de GNOME System Monitor, Activity Monitor (macOS), ou htop. Affiche les ressources système en temps réel et permet de gérer les processus.

### UI

```
┌──────────────────────────────────────────────────────────────┐
│  🖥 Moniteur Système                                     ≡  │
│  ─────────────────────────────────────────────────────────── │
│  [Vue d'ensemble] [Processus] [Ressources] [Système de fich]│
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │    CPU   │  │   RAM    │  │  Disque  │  │  Réseau  │    │
│  │  ╭──╮   │  │  ╭──╮   │  │          │  │          │    │
│  │  │23│%  │  │  │68│%  │  │    45%   │  │ ↓12 ↑3  │    │
│  │  ╰──╯   │  │  ╰──╯   │  │  used    │  │  MB/s   │    │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘    │
│                                                              │
│  Vue d'ensemble du CPU                                       │
│  100%│     ╱╲                                                │
│     │   ╱  ╲    ╱╲                                          │
│     │  ╱    ╲  ╱  ╲╱╲                                      │
│     │╱╱      ╲╱      ╲────                                  │
│   0%│─────────────────────── temps                           │
│     -5min            -1min              maintenant           │
└──────────────────────────────────────────────────────────────┘
```

### Onglets détaillés

#### 6.1 — Vue d'ensemble

```
Widgets temps réel :
├── CPU : jauge circulaire + graphe sparkline (dernières 5 min)
├── RAM : jauge + used/total (ex: "4.2 / 16.0 GB")
├── Swap : barre de progression + used/total
├── Disque : barre de progression par partition
├── Réseau : débits ↓/↑ en temps réel
├── Température CPU (si disponible)
├── Load average (1min, 5min, 15min)
└── Uptime du système
```

#### 6.2 — Processus

```
┌────────────────────────────────────────────────────────────┐
│  🔍 Rechercher un processus...                             │
│  ┌──────┬─────────────────┬───────┬───────┬───────┬──────┐│
│  │ PID  │ Nom             │ CPU % │ RAM % │ État  │ User ││
│  ├──────┼─────────────────┼───────┼───────┼───────┼──────┤│
│  │ 1234 │ zro-runtime     │  2.1  │  1.5  │ Run   │ dev  ││
│  │ 1235 │ zro-app-terminal│  0.5  │  0.8  │ Run   │ dev  ││
│  │ 1236 │ node            │  5.2  │  3.1  │ Run   │ dev  ││
│  │ 1237 │ bash            │  0.0  │  0.1  │ Sleep │ dev  ││
│  └──────┴─────────────────┴───────┴───────┴───────┴──────┘│
│                                                            │
│  Tri : [Nom ▼] | Afficher : [Tous ▼] | [🔄 Rafraîchir]   │
│                                                            │
│  Actions : [🛑 Terminer] [⚡ Tuer] [⏸ Suspendre]          │
└────────────────────────────────────────────────────────────┘

Fonctionnalités :
├── Liste triable par : PID, Nom, CPU, RAM, État, Utilisateur
├── Recherche/filtre par nom de processus
├── Arborescence parent-enfant (vue tree optionnelle)
├── Actions : SIGTERM, SIGKILL, SIGSTOP, SIGCONT
├── Détails d'un processus (clic) : cmdline, env, fd ouverts, cwd
├── Rafraîchissement automatique (1s / 2s / 5s configurable)
└── Filtrage par utilisateur
```

#### 6.3 — Ressources (graphiques détaillés)

```
Graphiques :
├── CPU : graphe par cœur (8 lignes pour 8 cœurs)
├── RAM : stacked area (used, buffers, cache, free)
├── Réseau : graphe download/upload par interface
├── Disque I/O : graphe reads/writes par disque
└── GPU (si nvidia-smi disponible) : usage, VRAM, temp

Période : [1min] [5min] [15min] [1h]
```

#### 6.4 — Système de fichiers

```
Partitions :
├── Tableau : Device, Mount point, Type, Size, Used, Available, Usage%
├── Barre de progression colorée par partition
└── Alerte visuelle si utilisation > 90%
```

### Backend

```
Commandes :
├── get_cpu_usage()       → % par cœur + total
├── get_memory_info()     → RAM used/total, swap used/total
├── get_disk_usage()      → par partition
├── get_network_stats()   → débits par interface
├── get_cpu_temperature() → température si disponible
├── get_load_average()    → 1, 5, 15 min
├── get_uptime()          → durée depuis le boot
├── get_processes()       → liste avec PID, nom, CPU%, RAM%, état, user
├── get_process_detail(pid) → cmdline, env, cwd, fd
├── signal_process(pid, signal) → envoyer un signal (TERM, KILL, STOP, CONT)
└── get_filesystem_info() → partitions avec usage

Streaming (event-source ou polling) :
├── Le frontend poll toutes les 1-2s pour les graphes
├── Ou : WebSocket stream dédié pour les métriques temps réel
└── Buffer circulaire côté frontend (5 min de données)
```

---

## 7. Caméra / Webcam

> **État : ❌ À créer**
> **Priorité : 🟢 Nice to have**
> **Catégorie : Multimédia**

### Description
Application d'accès à la webcam pour prendre des photos et des vidéos. Équivalent de Cheese (GNOME) ou Kamoso (KDE).

### Particularité navigateur
La webcam est celle de **l'ordinateur client** (pas du serveur). On utilise l'API `navigator.mediaDevices.getUserMedia()` du navigateur.

### UI

```
┌───────────────────────────────────────┐
│  📷 Caméra                       ≡   │
│  ─────────────────────────────────── │
│  ┌─────────────────────────────────┐ │
│  │                                 │ │
│  │         [Flux vidéo live]       │ │
│  │                                 │ │
│  │                                 │ │
│  └─────────────────────────────────┘ │
│                                       │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐        │
│  │ 📷 │ │ 🎥 │ │ 🔄 │ │ ⚙️ │        │
│  │Photo│ │Vidéo│ │Flip│ │Sett│        │
│  └────┘ └────┘ └────┘ └────┘        │
│                                       │
│  Galerie récente :                    │
│  ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐          │
│  │  │ │  │ │  │ │  │ │  │          │
│  └──┘ └──┘ └──┘ └──┘ └──┘          │
└───────────────────────────────────────┘
```

### Fonctionnalités

```
Photo :
├── Capture instantanée
├── Timer (3s, 5s, 10s)
├── Burst mode (série de photos)
├── Filtres en temps réel (CSS filters) :
│   ├── Noir & blanc
│   ├── Sépia
│   ├── Inversion
│   ├── Contraste élevé
│   └── Flou
├── Miroir horizontal (flip)
└── Sauvegarde dans le dossier ~/Images/Camera (sur le serveur via upload)

Vidéo :
├── Enregistrement avec indicateur durée
├── Pause/Resume
├── Format : WebM (natif navigateur)
├── Sauvegarde sur le serveur
└── Limitation de durée configurable

Paramètres :
├── Sélection de la source (si plusieurs caméras)
├── Résolution (si l'appareil le supporte)
├── Sélection du microphone (pour la vidéo)
└── Format de sauvegarde

Galerie :
├── Miniatures des captures récentes
├── Clic pour ouvrir dans le visionneur d'images (ou le media player pour vidéo)
└── Boutons : partager, supprimer, ouvrir le dossier
```

### Implémentation technique
- **Frontend principal** : `getUserMedia()`, `<video>` element, `canvas` pour la capture
- **Backend** : endpoint d'upload pour sauvegarder les photos/vidéos sur le serveur
- Les filtres sont des CSS `filter` appliqués sur le `<video>` et le `<canvas>`
- L'enregistrement vidéo utilise `MediaRecorder` API

---

## 8. Navigateur web (Web Browser)

> **État : ❌ À créer**
> **Priorité : 🔴 Critique**
> **Catégorie : Internet**

### Description
Un navigateur web intégré au bureau ZRO, utilisant des iframes pour afficher des sites web. C'est une approche unique — pas un vrai moteur de rendu, mais un wrapper iframe intelligent.

### Limites fondamentales des iframes

```
Ce qui FONCTIONNE dans une iframe :
├── Sites sans restriction X-Frame-Options
├── Applications web personnelles
├── Services internes (intranet)
├── Pages statiques
├── Beaucoup de SPAs modernes (React, Vue, etc.)
└── Documentation en ligne

Ce qui NE FONCTIONNE PAS :
├── Sites avec X-Frame-Options: DENY (Google, Facebook, Twitter, etc.)
├── Sites avec Content-Security-Policy frame-ancestors restrictif
├── Sites nécessitant des cookies tiers (si bloqués par le navigateur)
└── Sites avec des scripts anti-iframe (framebusting)

Contournements possibles :
├── Proxy inverse côté serveur (le runtime fetch le site → le sert via son propre domaine)
│   ⚠️ Complexe, potentiellement problématique (cookies, CORS, assets relatifs)
├── Mode "ouverture externe" : ouvrir dans un nouvel onglet navigateur réel
├── Bookmarks + raccourcis : même si certains sites ne s'affichent pas en iframe,
│   on peut les bookmarker et les ouvrir en externe
└── Web Apps installables : possibilité d'ajouter des PWAs
```

### UI

```
┌───────────────────────────────────────────────────────────────┐
│  🌐 Navigateur                                           ≡   │
│  ────────────────────────────────────────────────────────────│
│  [←] [→] [🔄] [🏠]  [https://example.com         ] [⭐] [≡]│
│  ─────────────────────────────────────────────────────────── │
│  [Tab 1: Example] [Tab 2: Docs] [+]                         │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │                                                         │ │
│  │                   [Contenu iframe]                      │ │
│  │                                                         │ │
│  │             Site web affiché ici                         │ │
│  │                                                         │ │
│  │                                                         │ │
│  └─────────────────────────────────────────────────────────┘ │
│  ──────────────────────────────────────────────────────────  │
│  ℹ️ Chargement... | 🔒 Connexion sécurisée                   │
└───────────────────────────────────────────────────────────────┘
```

### Fonctionnalités

```
Navigation :
├── Barre d'adresse (URL) avec autocomplétion depuis l'historique
├── Boutons : Précédent, Suivant, Recharger, Accueil
├── Onglets multiples dans la fenêtre
├── Page d'accueil personnalisable (favoris en grille, moteur de recherche)
├── Ouvrir dans un onglet navigateur réel (bouton "Ouvrir en externe")
└── Barre de progression de chargement

Favoris / Bookmarks :
├── Étoile dans la barre d'adresse pour ajouter
├── Barre de favoris sous la barre d'adresse (optionnelle)
├── Gestionnaire de favoris (arborescence de dossiers)
├── Import/Export (HTML standard)
└── Favoris en grille sur la page d'accueil

Historique :
├── Liste chronologique des sites visités
├── Recherche dans l'historique
├── Effacer l'historique (par période ou tout)
└── Persisté via le backend (SQLite)

Gestion des erreurs iframe :
├── Détection : si l'iframe ne charge pas en 10s → afficher un message
├── "Ce site ne peut pas être affiché dans le navigateur intégré"
├── Bouton : "Ouvrir dans un nouvel onglet" (window.open)
├── Bouton : "Essayer via le proxy" (si proxy configuré)
└── Suggestions de sites compatibles

Page d'accueil :
┌──────────────────────────────────────────┐
│           🔍 Rechercher sur le web       │
│  ┌────────────────────────────────────┐  │
│  │  DuckDuckGo / Google / Bing       │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ★ Favoris                               │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐       │
│  │Doc  │ │Wiki │ │Git  │ │Mail │       │
│  └─────┘ └─────┘ └─────┘ └─────┘       │
│                                          │
│  🕐 Récemment visités                    │
│  ┌─────┐ ┌─────┐ ┌─────┐               │
│  │...  │ │...  │ │...  │               │
│  └─────┘ └─────┘ └─────┘               │
└──────────────────────────────────────────┘
```

### Backend

```
Commandes :
├── get_bookmarks()              → arborescence des favoris
├── add_bookmark(url, title, folder)
├── remove_bookmark(id)
├── get_history(limit, offset)   → historique paginé
├── search_history(query)
├── clear_history(before_date)
├── proxy_fetch(url)             → fetch un site et retourner le HTML
│   ⚠️ Sécurité : whitelist d'URL, validation, rate limiting
├── get_homepage_config()        → config de la page d'accueil
└── set_homepage_config(config)
```

---

## 9. Éditeur de texte (Notes / Text Editor)

> **État : ✅ Existe, à améliorer fortement**
> **Priorité : 🔶 Amélioration**
> **Catégorie : Outils**

### Existant
- Sidebar avec liste des notes
- Textarea basique pour l'édition
- CRUD complet (create, list, edit, delete)
- Stockage dans des fichiers sur le serveur

### Vision : duo Notes + Text Editor

L'app actuelle "Notes" devrait devenir un **éditeur de texte complet** (type Mousepad, Kate, gedit) capable d'ouvrir n'importe quel fichier, avec un mode "notes rapides" en bonus.

### UI cible

```
┌──────────────────────────────────────────────────────────────┐
│  📝 Éditeur                                              ≡  │
│  ─────────────────────────────────────────────────────────── │
│  [Fichier ▼] [Édition ▼] [Affichage ▼] [Outils ▼]          │
│  ─────────────────────────────────────────────────────────── │
│  [notes.md] [config.toml] [script.py]  [+]                  │
│  ─────────────────────────────────────────────────────────── │
│  │  1 │ # Mon document                                      │
│  │  2 │                                                      │
│  │  3 │ Ceci est un **fichier Markdown** avec:              │
│  │  4 │                                                      │
│  │  5 │ - De la syntaxe colorée                              │
│  │  6 │ - Des numéros de ligne                               │
│  │  7 │ - De l'indentation automatique                       │
│  │  8 │                                                      │
│  │  9 │ ```python                                            │
│  │ 10 │ def hello():                                         │
│  │ 11 │     print("World")                                   │
│  │ 12 │ ```                                                  │
│  ──────────────────────────────────────────────────────────  │
│  Ln 5, Col 12 | UTF-8 | Markdown | 4 spaces | LF       ●   │
└──────────────────────────────────────────────────────────────┘
```

### Fonctionnalités

```
Édition :
├── Coloration syntaxique (200+ langages via highlight.js ou CodeMirror)
├── Numéros de ligne
├── Indentation automatique
├── Auto-complétion des parenthèses/crochets/guillemets
├── Sélection multiple (Ctrl+D)
├── Recherche et remplacement (Ctrl+H) avec regex
├── Undo/Redo illimité (Ctrl+Z / Ctrl+Shift+Z)
├── Aller à la ligne (Ctrl+G)
├── Minimap (preview en miniature du document)
└── Word wrap toggle

Fichiers :
├── Ouvrir n'importe quel fichier du système
├── Onglets multiples
├── Indicateur de modifications non sauvegardées (●)
├── Auto-save configurable (off / 5s / 30s / 1min)
├── Encodage détecté et configurable (UTF-8, ASCII, Latin-1...)
├── Fin de ligne configurable (LF / CRLF)
├── Nouveau fichier (Ctrl+N)
├── Sauvegarder (Ctrl+S)
└── Sauvegarder sous (Ctrl+Shift+S)

Mode Notes rapides :
├── Panel latéral avec liste des notes (comme l'actuel)
├── Création rapide (un clic)
├── Notes stockées dans un dossier dédié (~/.local/share/zro/notes/)
├── Tri par date de modification
├── Recherche dans les titres et le contenu
└── Favoris / épingler des notes

Aperçu Markdown :
├── Toggle preview (Ctrl+Shift+M)
├── Split view : éditeur | preview côte à côte
├── Rendu en temps réel
├── Support GitHub Flavored Markdown
├── Mermaid diagrams, math (KaTeX)
└── Export en HTML/PDF

Barre d'état :
├── Position du curseur (ligne, colonne)
├── Encodage du fichier
├── Langage détecté
├── Indentation (tabs/spaces + taille)
├── Fin de ligne (LF/CRLF)
└── Indicateur de modification
```

### Implémentation
- Utiliser **CodeMirror 6** comme éditeur (modulaire, performant, extensible)
- L'ancien mode "Notes" devient un panel latéral dans le nouvel éditeur
- Backend existant déjà quasi suffisant, ajouter `write_file`, `get_file_info`

---

## 10. Visionneuse d'images (Image Viewer)

> **État : ❌ À créer**
> **Priorité : 🟡 Important**
> **Catégorie : Multimédia**

### Description
Application d'affichage d'images avec navigation, zoom, rotation. Équivalent d'Eye of GNOME ou Gwenview.

### UI

```
┌──────────────────────────────────────────────────────────────┐
│  🖼 Visionneuse                                          ≡  │
│  [←] [→]  photo_001.jpg (3/42)    [🔍+][🔍-][↻][↺][🗑][ℹ] │
│  ─────────────────────────────────────────────────────────── │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │                                                         │ │
│  │                                                         │ │
│  │                   [ Image affichée ]                    │ │
│  │                                                         │ │
│  │                                                         │ │
│  └─────────────────────────────────────────────────────────┘ │
│  ─────────────────────────────────────────────────────────── │
│  ┌──┐ ┌──┐ ┌██┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐  (filmstrip)         │
│  └──┘ └──┘ └──┘ └──┘ └──┘ └──┘ └──┘                       │
└──────────────────────────────────────────────────────────────┘
```

### Fonctionnalités

```
Affichage :
├── Formats : JPEG, PNG, GIF (animé), WebP, SVG, BMP, ICO, TIFF
├── Zoom : molette / pinch / boutons (fit, fill, 100%, personnalisé)
├── Pan : clic-drag quand zoomé
├── Rotation : 90° horaire / anti-horaire
├── Miroir horizontal / vertical
└── Plein écran (F11 ou double-clic)

Navigation :
├── Image précédente/suivante dans le dossier
├── Raccourcis : ← → ou espace pour suivant
├── Filmstrip (miniatures) en bas
├── Compteur : "3 / 42"
└── Diaporama automatique (intervalle configurable)

Informations :
├── Panel d'infos (ℹ) : dimensions, taille, format, date, EXIF
├── Histogramme (optionnel)
└── Chemin complet du fichier

Édition légère :
├── Recadrer (crop)
├── Rotation (avec sauvegarde)
├── Ajustement basique : luminosité, contraste, saturation
├── "Sauvegarder sous" pour ne pas écraser l'original
└── Définir comme fond d'écran

Actions :
├── Copier l'image (clipboard)
├── Ouvrir avec une autre app
├── Supprimer (vers la corbeille)
├── Imprimer (window.print())
└── Partager / télécharger
```

### Backend

```
Commandes :
├── get_image(path)             → image en base64 ou URL servie
├── get_image_info(path)        → dimensions, format, EXIF, taille
├── get_thumbnail(path, size)   → miniature redimensionnée
├── list_images(directory)      → lister les images d'un dossier
├── rotate_image(path, degrees) → rotation avec sauvegarde
├── crop_image(path, x,y,w,h)  → recadrage
└── adjust_image(path, brightness, contrast, saturation):
```

---

## 11. Capture d'écran (Screenshot)

> **État : ❌ À créer**
> **Priorité : 🟡 Important**
> **Catégorie : Outils**

### Description
Outil de capture d'écran du bureau ZRO. Utilise l'API Canvas pour capturer le contenu des fenêtres.

### Modes de capture

```
Modes :
├── Bureau complet : capture tout le viewport
├── Fenêtre active : capture uniquement la fenêtre en focus
├── Zone sélectionnée : l'utilisateur dessine un rectangle
├── Timer : capture après 3s / 5s / 10s (pour capturer des menus)
└── Fenêtre spécifique : sélection par clic sur une fenêtre

Après la capture :
├── Aperçu immédiat avec outils d'annotation :
│   ├── Flèches
│   ├── Rectangles / cercles
│   ├── Texte
│   ├── Surligneur (highlight)
│   ├── Flou / pixelisation (pour masquer des infos)
│   └── Stylo libre
├── Copier dans le presse-papiers
├── Sauvegarder en fichier (PNG/JPEG, ~/Images/Screenshots/)
├── Partager (si système de partage implémenté)
└── Ouvrir dans l'éditeur d'images
```

### Problématique technique
- `html2canvas` ou `dom-to-image` pour capturer le DOM du shell
- Les iframes sont une difficulté : le contenu cross-origin ne peut pas être capturé
  - Solution : demander à chaque app de fournir sa propre capture via `postMessage`
  - Ou : capturer le shell (fenêtres) mais avec un placeholder pour le contenu iframe
- `getDisplayMedia()` API : permet une vraie capture d'écran (avec permission utilisateur)
  → Plus fiable mais demande une confirmation navigateur à chaque fois

### UI minimale
- Pas de fenêtre permanente
- Raccourci `PrtSc` → capture plein écran → notification avec aperçu
- Raccourci `Super+Shift+S` → sélection de zone
- La notification propose : Copier / Sauvegarder / Annoter

---

## 12. Lecteur multimédia (Media Player)

> **État : ❌ À créer**
> **Priorité : 🟢 Nice to have**
> **Catégorie : Multimédia**

### Description
Lecteur audio et vidéo intégré. Utilise les balises HTML5 `<audio>` et `<video>`.

### UI Vidéo

```
┌──────────────────────────────────────────────────────────────┐
│  ▶ Media Player                                          ≡  │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │                                                         │ │
│  │                                                         │ │
│  │                   [ Vidéo ]                             │ │
│  │                                                         │ │
│  │                                                         │ │
│  └─────────────────────────────────────────────────────────┘ │
│  ▶ ▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░ 02:34 / 10:12                │
│  [⏮] [⏪] [⏯] [⏩] [⏭]  🔊▓▓▓░░  [🖥] [CC] [⚙️]        │
└──────────────────────────────────────────────────────────────┘
```

### Fonctionnalités

```
Vidéo :
├── Formats : MP4, WebM, OGG (natifs HTML5)
├── Contrôles : play/pause, seek, volume, mute
├── Plein écran
├── Vitesse de lecture : 0.5x, 1x, 1.5x, 2x
├── Sous-titres : chargement de fichiers .srt / .vtt
├── Picture-in-Picture (API navigateur)
└── Playlist (lecture enchaînée de fichiers d'un dossier)

Audio :
├── Formats : MP3, WAV, OGG, FLAC, AAC (natifs HTML5)
├── Contrôles : play/pause, seek, volume
├── Pochette d'album (si métadonnées ID3 disponibles)
├── Waveform / visualisation
├── Playlist / file d'attente
├── Shuffle / Repeat (one / all)
├── Mini-player dans le system tray
└── Notification "En cours de lecture : Artiste — Titre"

Gestion des fichiers :
├── Ouvrir un fichier (depuis le file manager ou "Ouvrir avec...")
├── Ouvrir un dossier (toute la musique/vidéos dedans → playlist)
├── Historique des fichiers récents
└── Drag-drop de fichiers sur le lecteur
```

### Backend

```
Commandes :
├── stream_media(path)      → URL de streaming du fichier
├── get_media_info(path)    → durée, codec, bitrate, métadonnées
├── list_media(directory)   → lister les fichiers multimédia d'un dossier
└── get_album_art(path)     → pochette d'album (extraction ID3)
```

---

## 13. Calendrier (Calendar)

> **État : ❌ À créer**
> **Priorité : 🟢 Nice to have**
> **Catégorie : Productivité**

### Description
Application de calendrier avec vue jour/semaine/mois et gestion d'événements.

### UI

```
┌──────────────────────────────────────────────────────────────┐
│  📅 Calendrier                                           ≡  │
│  [< Mars 2026 >]           [Jour] [Semaine] [Mois] [Année] │
│  ─────────────────────────────────────────────────────────── │
│  │ Lun   │ Mar   │ Mer   │ Jeu   │ Ven   │ Sam   │ Dim   │ │
│  ├───────┼───────┼───────┼───────┼───────┼───────┼───────┤ │
│  │   1   │   2   │   3   │   4   │   5   │   6   │   7   │ │
│  │       │ ●Réu  │       │       │       │       │       │ │
│  ├───────┼───────┼───────┼───────┼───────┼───────┼───────┤ │
│  │   8   │   9   │  10   │  11   │ [12]  │  13   │  14   │ │
│  │       │       │ ●Dea  │       │ TODAY │       │       │ │
│  ├───────┼───────┼───────┼───────┼───────┼───────┼───────┤ │
│  │  15   │  16   │  17   │  18   │  19   │  20   │  21   │ │
│  │       │       │       │ ●Ann  │       │       │       │ │
│  └───────┴───────┴───────┴───────┴───────┴───────┴───────┘ │
│                                                              │
│  Aujourd'hui :                                               │
│  ─ 10:00 Réunion d'équipe (1h)                               │
│  ─ 14:00 Review PR #42 (30min)                               │
│  [+ Nouvel événement]                                         │
└──────────────────────────────────────────────────────────────┘
```

### Fonctionnalités

```
Vues :
├── Jour : timeline 00:00-23:00 avec blocs d'événements
├── Semaine : 7 colonnes avec timeline
├── Mois : grille mensuelle avec indicateurs d'événements
├── Année : 12 mini-calendriers
└── Agenda : liste chronologique des événements à venir

Événements :
├── Création rapide (clic sur une case → popup)
├── Titre, description, lieu
├── Date de début / fin
├── Heure de début / fin (ou journée entière)
├── Récurrence : quotidien, hebdomadaire, mensuel, annuel, personnalisé
├── Rappels : 5min, 15min, 30min, 1h, 1j avant
├── Couleur / catégorie
├── Drag pour déplacer un événement
├── Resize pour changer la durée
└── Suppression (avec confirmation si récurrent)

Calendriers multiples :
├── Calendrier personnel (par défaut)
├── Créer des calendriers supplémentaires (travail, perso, projet...)
├── Couleur par calendrier
├── Afficher / masquer un calendrier
└── Import CalDAV / iCal (.ics) — optionnel, avancé

Intégration :
├── Widget calendrier dans le panel (clic sur l'horloge)
├── Notifications de rappel (via le système de notifications)
└── Intégration avec Tasks (deadline = événement calendrier)
```

### Backend

```
Commandes :
├── get_events(start, end)      → événements dans une plage
├── create_event(event)         → créer un événement
├── update_event(id, event)     → modifier
├── delete_event(id)            → supprimer
├── get_calendars()             → liste des calendriers
├── create_calendar(name, color)
├── import_ical(data)           → importer un .ics
└── export_ical(calendar_id)    → exporter en .ics
```

---

## 14. Gestionnaire de tâches (Tasks)

> **État : ✅ Existe, à améliorer**
> **Priorité : 🔶 Amélioration**
> **Catégorie : Productivité**

### Existant
- Kanban 3 colonnes (todo, in_progress, done)
- Formulaire modal de création
- Priorités (4 niveaux)
- Catégories et filtrage
- Dates d'échéance

### Améliorations nécessaires

```
Drag-and-drop :
├── Glisser les cartes entre colonnes
├── Réordonner les cartes dans une colonne
├── Feedback visuel pendant le drag
└── Zone de drop mise en surbrillance

Sous-tâches :
├── Checklist dans une tâche
├── Progression (3/5 sous-tâches complétées)
├── Indentation des sous-tâches
└── Chaque sous-tâche a un checkbox

Enrichissement des cartes :
├── Description enrichie (Markdown)
├── Pièces jointes (fichiers)
├── Étiquettes / tags colorés
├── Assignation (si multi-utilisateur)
├── Commentaires sur une tâche
├── Historique d'activité
└── Estimation de temps

Rappels & Notifications :
├── Rappel configurable avant la deadline
├── Notification dans le centre de notifications
├── Tâches en retard mises en surbrillance (rouge)
└── Badge compteur dans la taskbar

Vues multiples :
├── Kanban (actuel, amélioré)
├── Liste (tableau triable)
├── Calendrier (intégration avec l'app Calendar)
└── Timeline / Gantt (optionnel)

Colonnes personnalisables :
├── Ajouter / supprimer / renommer des colonnes
├── Limiter le nombre de cartes par colonne (WIP limit)
└── Ordre des colonnes modifiable
```

---

## 15. Horloge / Minuteur (Clock)

> **État : ❌ À créer**
> **Priorité : 🟢 Nice to have**
> **Catégorie : Outils**

### Description
Application d'horloge avec alarmes, minuteur et chronomètre. Équivalent de GNOME Clocks.

### Fonctionnalités

```
Horloge mondiale :
├── Ajouter des villes / fuseaux horaires
├── Affichage analogique et/ou numérique
├── Différence horaire avec l'heure locale
└── Carte du monde avec indicateur jour/nuit (optionnel)

Alarme :
├── Créer des alarmes (heure, jours de récurrence)
├── Nom personnalisé
├── Son d'alarme (sélection)
├── Snooze (5min / 10min)
├── Activer / désactiver sans supprimer
└── Notification + son quand l'alarme se déclenche

Minuteur (Timer) :
├── Prédéfinis : 1min, 5min, 10min, 15min, 30min, 1h
├── Personnalisé (heures:minutes:secondes)
├── Affichage plein écran pendant le compte à rebours
├── Son à la fin
├── Pause / Annuler
└── Minuteurs multiples simultanés

Chronomètre (Stopwatch) :
├── Start / Stop / Reset
├── Tours (laps) avec temps intermédiaires
├── Affichage plein écran
└── Historique des sessions
```

---

## 16. Centre logiciel (Software Center)

> **État : ❌ À créer**
> **Priorité : 🟢 Nice to have (Phase tardive)**
> **Catégorie : Système**

### Description
Interface de gestion des applications ZRO installées et disponibles. Équivalent de GNOME Software ou KDE Discover, adapté à l'écosystème ZRO.

### Fonctionnalités

```
Catalogue :
├── Liste des apps installées avec version et état (running / stopped)
├── Liste des apps disponibles (depuis un dépôt ZRO ou répertoire)
├── Recherche et filtrage par catégorie
├── Page détaillée par app :
│   ├── Description, captures d'écran
│   ├── Version, auteur, licence
│   ├── Permissions requises
│   ├── Taille
│   └── Bouton Installer / Désinstaller / Mettre à jour
├── Indication des mises à jour disponibles
└── Badge dans le tray : "3 mises à jour disponibles"

Gestion :
├── Installer une app (copier le binaire + manifest, enregistrer dans le registry)
├── Désinstaller (nettoyer)
├── Mettre à jour (hot reload existant dans le runtime)
├── Activer / Désactiver une app (sans supprimer)
├── Voir les logs d'une app
└── Redémarrer une app

Développeur :
├── Installer depuis un chemin local (manifest.toml + backend)
├── Mode debug (logs verbeux)
└── Éditeur de manifest.toml
```

### Backend
Le runtime possède déjà :
- Le registre d'apps (`registry.rs`)
- Le hot reload (`hot_reload.rs`)
- Le superviseur (`supervisor.rs`)
- La CLI pour `deploy`, `undeploy`, `list`, `status`

Le Software Center est une interface graphique sur ces capacités existantes.

---

## Résumé des priorités d'implémentation

| Priorité | Applications |
|----------|-------------|
| 🔴 **Phase 1 — Critique** | Settings, System Monitor, Web Browser, Files (refonte) |
| 🔶 **Phase 2 — Important** | Terminal (tabs/splits), Text Editor (CodeMirror), Calculator, Image Viewer, Screenshot |
| 🟢 **Phase 3 — Enrichissement** | Camera, Media Player, Calendar, Tasks (D&D), Clock, Software Center |
