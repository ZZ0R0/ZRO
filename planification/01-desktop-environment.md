# ZRO — État de l'art : Environnement de Bureau

> Document de planification — Mars 2026
> Objectif : Définir toutes les composantes d'un environnement de bureau Linux complet, analyser l'existant ZRO, et spécifier ce qui doit être construit pour atteindre la parité fonctionnelle.

---

## Table des matières

1. [Anatomie d'un environnement de bureau Linux](#1-anatomie-dun-environnement-de-bureau-linux)
2. [Le bureau (Desktop Surface)](#2-le-bureau-desktop-surface)
3. [Le window manager](#3-le-window-manager)
4. [Les panneaux (Panels / Taskbar)](#4-les-panneaux-panels--taskbar)
5. [Le lanceur d'applications](#5-le-lanceur-dapplications)
6. [Le système de notifications](#6-le-système-de-notifications)
7. [Le centre de paramètres rapides](#7-le-centre-de-paramètres-rapides)
8. [Le système de thèmes](#8-le-système-de-thèmes)
9. [Le presse-papiers global](#9-le-presse-papiers-global)
10. [Le glisser-déposer inter-applications](#10-le-glisser-déposer-inter-applications)
11. [Les raccourcis clavier globaux](#11-les-raccourcis-clavier-globaux)
12. [Le système de fichiers et associations MIME](#12-le-système-de-fichiers-et-associations-mime)
13. [L'écran de verrouillage](#13-lécran-de-verrouillage)
14. [Les espaces de travail virtuels](#14-les-espaces-de-travail-virtuels)
15. [L'accessibilité](#15-laccessibilité)
16. [Audit de l'existant ZRO](#16-audit-de-lexistant-zro)

---

## 1. Anatomie d'un environnement de bureau Linux

Un environnement de bureau (DE) complet comme GNOME, KDE Plasma ou XFCE est composé de couches distinctes :

```
┌─────────────────────────────────────────────────────────────────┐
│                    Couche visible (UI)                          │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  ┌──────────────┐  │
│  │ Desktop  │  │ Panels   │  │ Launcher  │  │ Notifications│  │
│  │ Surface  │  │ /Taskbar │  │           │  │              │  │
│  └──────────┘  └──────────┘  └───────────┘  └──────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│                Couche window management                         │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Window Manager (placement, focus, z-order, snapping,    │  │
│  │  tiling, workspaces, animations, transitions)            │  │
│  └──────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│                Couche services système                          │
│  ┌────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────┐ │
│  │Clipboard│ │Drag-Drop │ │  Theme   │ │ Keyboard │ │ MIME  │ │
│  │Manager  │ │ System   │ │  Engine  │ │ Shortcuts│ │Assoc. │ │
│  └────────┘ └──────────┘ └──────────┘ └──────────┘ └───────┘ │
├─────────────────────────────────────────────────────────────────┤
│                Couche session / sécurité                        │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ Lock Screen  │  │ Screen Saver │  │ Session Management   │  │
│  └─────────────┘  └──────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Comparaison des DE existants

| Composante | GNOME 46 | KDE Plasma 6 | XFCE 4.18 | ZRO (actuel) |
|-----------|----------|-------------|-----------|-------------|
| Desktop surface | Fichiers sur bureau (désactivé par défaut) | Bureau avec widgets | Fichiers + icônes | ❌ Espace vide |
| Fond d'écran | ✅ Dynamique + diaporama | ✅ Wallpaper Engine | ✅ Statique | ❌ Couleur unie |
| Panel/Taskbar | Top bar | Bottom panel | Top + bottom | ⚠️ Basique (bas) |
| Lanceur | Activities + recherche | KRunner + menu | Whisker Menu | ⚠️ Grille simple |
| Window management | Float + tile (GNOME 46) | Float + tile | Float | ✅ Float complet |
| Snapping | ✅ Bords + quarts | ✅ Complet | ⚠️ Basique | ❌ Absent |
| Notifications | Centre + bannières | idem | idem | ⚠️ Toasts simples |
| Paramètres rapides | Quick Settings panel | System Tray | Panel plugins | ❌ Absent |
| Thèmes | Adwaita (light/dark) | Breeze + accents | GTK themes | ⚠️ Dark uniquement |
| Presse-papiers | GPaste | Klipper (historique) | xfce4-clipman | ❌ Absent |
| Drag & Drop | Inter-apps via Wayland | idem | idem | ❌ Absent |
| Raccourcis | Configurable | Très configurable | Configurable | ❌ Absent |
| Lock screen | GDM | SDDM | LightDM | ❌ Absent |
| Workspaces | Dynamiques | Configurable | Fixes | ❌ Absent |
| Accessibilité | Orca, zoom, haut contraste | Full a11y | Basique | ❌ Absent |

---

## 2. Le bureau (Desktop Surface)

### Ce que c'est
L'arrière-plan de l'écran, la toile sur laquelle tout est posé. Dans un vrai DE :

- **Fond d'écran** : Image statique, diaporama, couleur unie, ou fond dynamique
- **Icônes de bureau** : Raccourcis vers des fichiers, dossiers, ou apps
- **Widgets de bureau** : Horloge, météo, notes sticky, monitoring système
- **Menu contextuel (clic droit)** : Changer le fond, créer fichier/dossier, arranger les icônes, ouvrir un terminal ici, paramètres d'affichage

### Spécification pour ZRO

#### 2.1 — Fond d'écran

```
Fonctionnalités requises :
├── Sélection d'image (depuis le file manager ou URL)
├── Galerie de fonds intégrés (10-15 wallpapers HD par défaut)
├── Modes d'affichage : fill, fit, stretch, center, tile
├── Couleur unie / dégradé comme alternative
├── Diaporama avec intervalle configurable
├── Persistance par utilisateur
└── Prévisualisation avant application
```

**Implémentation technique :**
- Les images de fond sont stockées dans un répertoire partagé (ex: `static/wallpapers/`) ou uploadées par l'utilisateur
- Le shell charge le fond via CSS `background-image` sur le `#desktop`
- Le choix est sauvegardé via le module `state` du SDK (persiste en SQLite)
- Un endpoint HTTP sert les images wallpaper (pas besoin d'IPC pour ça)

#### 2.2 — Icônes de bureau

```
Fonctionnalités requises :
├── Placement libre par drag-and-drop sur le bureau
├── Alignement sur grille (snap-to-grid optionnel)
├── Types : raccourci app, fichier, dossier, lien URL
├── Double-clic pour ouvrir
├── Clic droit → menu contextuel (renommer, supprimer, propriétés)
├── Sélection multiple (rectangle de sélection / Ctrl+clic)
└── Persistance de la disposition par utilisateur
```

#### 2.3 — Menu contextuel du bureau

```
Clic droit sur le bureau :
├── Nouveau fichier       → crée sur le bureau virtuel
├── Nouveau dossier       → idem
├── Ouvrir un terminal ici
├── Arranger les icônes    → tri par nom/type/date
├── Aligner sur la grille
├── ─────────────────────
├── Fond d'écran           → ouvre le sélecteur
├── Paramètres d'affichage → résolution, thème
└── Paramètres             → ouvre l'app Settings
```

### État actuel ZRO
- ❌ Pas de fond d'écran (couleur CSS `#1e1e2e` uniquement)
- ❌ Pas d'icônes de bureau
- ❌ Pas de widgets de bureau
- ❌ Pas de menu contextuel sur le bureau (uniquement sur les titres de fenêtre)

---

## 3. Le window manager

### Ce que c'est
Le composant qui gère le cycle de vie, le placement, le redimensionnement, le focus et l'organisation des fenêtres.

### Fonctionnalités d'un WM complet

#### 3.1 — Gestion des fenêtres (EXISTANT dans ZRO ✅)

| Feature | GNOME/KDE | ZRO actuel |
|---------|----------|------------|
| Fenêtres flottantes | ✅ | ✅ |
| Drag (déplacement) | ✅ | ✅ GPU-accéléré |
| Resize (8 directions) | ✅ | ✅ |
| Minimize | ✅ | ✅ |
| Maximize | ✅ | ✅ + double-clic |
| Close | ✅ | ✅ |
| Focus / Z-order | ✅ | ✅ |
| Menu contextuel titre | ✅ | ✅ |
| Pop-out (nouveau tab) | ❌ natif | ✅ |
| Persistance état | ✅ | ✅ |

#### 3.2 — Window snapping / tiling (À IMPLÉMENTER)

C'est une fonctionnalité **indispensable** des DE modernes (GNOME 46, Windows 11, KDE) :

```
Snapping :
├── Glisser vers le bord gauche → occupe 50% gauche
├── Glisser vers le bord droit  → occupe 50% droite
├── Glisser vers le haut        → maximize
├── Glisser vers un coin        → occupe 25% (quart d'écran)
├── Zone de preview (overlay semi-transparent avant le snap)
└── Restaurer taille originale au dé-snap

Tiling assisté (type Windows 11 Snap Layouts) :
├── Hover sur le bouton maximize → affiche grille de layouts
│   ├── ½ + ½
│   ├── ⅓ + ⅔
│   ├── ⅓ + ⅓ + ⅓
│   ├── ¼ + ¼ + ¼ + ¼
│   └── Personnalisé
└── Cliquer un layout → les fenêtres s'arrangent
```

**Raccourcis clavier associés :**
- `Super + ←/→` : snap gauche/droite
- `Super + ↑` : maximize
- `Super + ↓` : restore / minimize
- `Super + Shift + ←/→` : envoyer vers workspace précédent/suivant

#### 3.3 — Animations et transitions (À IMPLÉMENTER)

```
Animations attendues :
├── Ouverture de fenêtre    : scale-in (0.95→1.0) + fade-in (~200ms)
├── Fermeture de fenêtre    : scale-out (1.0→0.95) + fade-out (~150ms)
├── Minimize                : shrink vers le bouton taskbar (fly-to animation)
├── Maximize                : expansion fluide vers plein écran (~200ms)
├── Snap                    : slide + resize fluide vers la zone cible (~200ms)
├── Changement de workspace : slide horizontal entre bureaux
├── Lanceur                 : fade-in / blur background
└── Tous via CSS transitions + requestAnimationFrame (pas de librairie)
```

#### 3.4 — Gestion avancée des fenêtres (À IMPLÉMENTER)

```
Features avancées :
├── Always on top        : une fenêtre reste au-dessus de toutes les autres
├── Always on workspace  : fenêtre sticky visible sur tous les workspaces
├── Fenêtre semi-transparente (opacité réglable)
├── Groupage de fenêtres (tabs comme dans i3/sway)
├── Cascade automatique  : réarranger toutes les fenêtres en cascade
├── Tile automatique     : réarranger en grille
├── Montrer le bureau    : minimise tout temporairement (Super+D)
└── Alt+Tab              : switcher de fenêtres avec preview
```

---

## 4. Les panneaux (Panels / Taskbar)

### Ce que c'est
Les barres fixes en haut/bas de l'écran contenant les indicateurs système, la liste des fenêtres, l'heure, etc.

### Anatomie d'un panel complet (style KDE/XFCE)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ [🏠 Menu] │ [App1] [App2] [App3]        │ [🔊][🌐][🔋][📶]│ [15:42] │
│  Lanceur   │   Fenêtres actives         │   System Tray    │ Horloge  │
└──────────────────────────────────────────────────────────────────────────┘
```

### 4.1 — Zone gauche : Lanceur d'applications

- Bouton unique qui ouvre le menu / launcher overlay
- Icône personnalisable (logo ZRO par défaut)

### 4.2 — Zone centrale : Liste des fenêtres actives

```
Actuellement dans ZRO :
  ✅ Boutons pour chaque fenêtre ouverte
  ✅ Clic pour focus/minimize
  ❌ Pas d'icône d'application (texte uniquement)
  ❌ Pas de preview au survol (thumbnail)
  ❌ Pas de groupement par app (si 3 terminaux → 3 boutons séparés)
  ❌ Pas de drag pour réordonner
```

**Améliorations nécessaires :**
- Icône de l'app à côté du titre
- Preview thumbnail au hover (capture du contenu de la fenêtre)
- Groupement optionnel (3 instances de Terminal → un bouton avec badge "3")
- Indicateur visuel de fenêtre active vs inactive
- Drag pour réordonner les boutons

### 4.3 — Zone droite : System Tray (Zone de notification)

C'est la zone d'indicateurs système. **Entièrement absent de ZRO actuellement.**

```
Indicateurs indispensables :
├── 🔊 Volume           : icône + slider au clic (muet/25%/50%/75%/100%)
├── 🌐 Réseau           : nom du réseau / IP / état (pas de contrôle car serveur)
├── 💻 Charge CPU/RAM   : mini graphe ou pourcentage
├── 🔔 Notifications    : icône + badge compteur + ouverture du centre
├── 👤 Utilisateur      : nom + menu (profil, déconnexion)
├── 🌙 Mode sombre      : toggle rapide
└── ⚡ Uptime/État      : indicateur que le serveur est connecté
```

**Note** : Contrairement à un vrai DE, certains indicateurs sont limités dans un navigateur :
- Pas d'accès au volume du système hôte (mais on peut contrôler le volume des médias dans le navigateur)
- Pas d'accès au WiFi/Bluetooth (mais on peut afficher l'IP et l'état réseau du serveur)
- Pas de batterie (c'est un serveur)

### 4.4 — Zone droite : Horloge

```
Actuellement dans ZRO :
  ✅ Horloge HH:MM (textuelle)
  ❌ Pas de date
  ❌ Pas de calendrier au clic
  ❌ Pas de fuseau horaire configurable
  ❌ Pas de format 24h/12h configurable
```

**Améliorations :**
- Afficher la date (Jour DD Mois)
- Clic → calendrier popup avec rendez-vous du jour
- Fuseaux horaires multiples optionnels
- Format configurable (24h par défaut)

### État actuel ZRO
- ✅ Panel en bas avec bouton lanceur + liste de fenêtres + horloge
- ❌ Pas de system tray
- ❌ Pas d'icônes dans la liste des fenêtres
- ❌ Pas de preview/thumbnail au survol
- ❌ Pas de calendrier
- ❌ Pas d'indicateurs système

---

## 5. Le lanceur d'applications

### Ce que c'est
L'interface pour trouver et lancer des applications. C'est le **point d'entrée central** vers tout le DE.

### Anatomie d'un lanceur complet

```
┌───────────────────────────────────────────────┐
│  🔍 [Rechercher des applications...]          │
│                                               │
│  ★ Favoris                                    │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐    │
│  │ 📁  │ │ 🖥  │ │ 📝  │ │ ⚙️  │ │ 🌐  │    │
│  │Files│ │Term │ │Notes│ │Sett.│ │Web  │    │
│  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘    │
│                                               │
│  📂 Catégories                                │
│  ┌───────────────────────────────────────┐    │
│  │ Toutes │ Système │ Outils │ Internet  │    │
│  └───────────────────────────────────────┘    │
│                                               │
│  Toutes les applications                      │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐            │
│  │ 📊  │ │ 🧮  │ │ 📷  │ │ 📺  │            │
│  │Monit│ │Calc │ │Cam  │ │Brows│            │
│  └─────┘ └─────┘ └─────┘ └─────┘            │
│                                               │
│  ──────────────────────────────────────────   │
│  🔌 Éteindre  │  🔒 Verrouiller  │  🚪 Déco │
└───────────────────────────────────────────────┘
```

### Fonctionnalités requises

```
Recherche :
├── Recherche par nom d'app (fuzzy matching)
├── Recherche par description
├── Recherche par catégorie
├── Résultats instantanés (filtrage local, pas de requête serveur)
├── Navigation clavier (↑↓ pour se déplacer, Enter pour lancer)
└── Ouverture rapide : Super (touche) → taper → Enter

Favoris :
├── Section dédiée en haut du launcher
├── Clic droit sur une app → "Ajouter aux favoris" / "Retirer"
├── Drag pour réordonner les favoris
└── Persistance par utilisateur

Catégories :
├── Toutes les applications
├── Système (Terminal, Fichiers, Moniteur, Paramètres)
├── Outils (Calculatrice, Notes, Tâches)
├── Internet (Navigateur, Web Apps)
└── Catégories personnalisées (définies dans manifest.toml)

Actions rapides (bas du launcher) :
├── 🔒 Verrouiller la session
├── 🚪 Se déconnecter
└── ⚙️ Ouvrir les paramètres
```

### État actuel ZRO
- ✅ Overlay launcher en plein écran
- ✅ Grille d'apps avec icônes
- ✅ Lancement au clic
- ❌ Pas de barre de recherche
- ❌ Pas de système de favoris
- ❌ Pas de catégories
- ❌ Pas de navigation clavier
- ❌ Pas d'actions rapides (lock, logout)
- ❌ Pas de tri/filtrage

---

## 6. Le système de notifications

### Ce que c'est
Le mécanisme par lequel les applications et le système informent l'utilisateur d'événements.

### Architecture complète

```
┌─────────────────────────────────────────────────┐
│               Centre de notifications            │
│  ┌────────────────────────────────────────────┐  │
│  │ 🔔 Aujourd'hui                  [Tout lire]│  │
│  ├────────────────────────────────────────────┤  │
│  │ 📁 Files — Téléchargement terminé    14:32 │  │
│  │    report.pdf (2.4 MB)          [Ouvrir]   │  │
│  ├────────────────────────────────────────────┤  │
│  │ 📋 Tasks — Échéance dans 1h          14:15 │  │
│  │    "Revue de code PR #42"       [Voir]     │  │
│  ├────────────────────────────────────────────┤  │
│  │ 🖥 Terminal — Commande terminée       13:58 │  │
│  │    `cargo build` (exit 0)       [Focus]    │  │
│  ├────────────────────────────────────────────┤  │
│  │ ⚙️ Système — Mise à jour disponible  13:45 │  │
│  │    3 apps ont une mise à jour   [MàJ]      │  │
│  └────────────────────────────────────────────┘  │
│                                                   │
│  ❌ Ne pas déranger                    [Effacer] │
└─────────────────────────────────────────────────┘
```

### Composantes

```
1. Notifications bannières (toasts)
   ├── Apparaissent en haut à droite
   ├── Disparaissent après 5s (configurable)
   ├── Niveaux : info, success, warning, error
   ├── Actions : boutons dans la notification
   └── Clic → focus l'app source

2. Centre de notifications (panel)
   ├── Liste chronologique des notifications non lues
   ├── Groupement par app
   ├── Actions : "Tout lire", "Effacer"
   ├── "Ne pas déranger" (supprime les bannières mais garde l'historique)
   └── Badge compteur dans le system tray

3. Notifications persistantes
   ├── Sauvegardées en SQLite
   ├── Historique consultable
   └── Limite configurable (ex: 100 dernières)
```

### Notification API pour les apps

```javascript
// Depuis une app ZRO
conn.notifications.send({
  title: "Téléchargement terminé",
  body: "report.pdf (2.4 MB)",
  icon: "📁",
  urgency: "normal",      // low | normal | critical
  actions: [
    { label: "Ouvrir", command: "open_file", params: { path: "/downloads/report.pdf" } }
  ],
  timeout: 5000,           // ms, 0 = persistant
});
```

### État actuel ZRO
- ⚠️ Toasts simples (texte uniquement, disparaissent automatiquement)
- ❌ Pas de centre de notifications
- ❌ Pas de persistance
- ❌ Pas d'actions dans les notifications
- ❌ Pas de "Ne pas déranger"
- ❌ Pas de badge compteur dans le tray

---

## 7. Le centre de paramètres rapides

### Ce que c'est
Le panel qui s'ouvre en cliquant sur les indicateurs système dans le tray. Présent dans GNOME, KDE, Windows, macOS, Android.

```
┌─────────────────────────────────────┐
│  👤 dev (admin)                     │
│  ────────────────────────────────── │
│  ┌──────┐  ┌──────┐  ┌──────┐     │
│  │🌙 Dark│  │🔔 DND │  │🔊 Vol │   │
│  │ Mode  │  │ Off   │  │ 75%  │   │
│  └──────┘  └──────┘  └──────┘     │
│                                     │
│  🔊 ▓▓▓▓▓▓▓▓▓▓░░░ 75%             │
│                                     │
│  💻 CPU: 23%  │  🧠 RAM: 4.2/16 GB │
│  💾 Disk: 45% │  🌡 Temp: 52°C     │
│                                     │
│  🌐 192.168.1.42 │ ⏱ Up: 3d 14h   │
│  ────────────────────────────────── │
│  [⚙️ Paramètres]  [🔒 Verrouiller] │
│  [🚪 Se déconnecter]               │
└─────────────────────────────────────┘
```

### Composantes

```
Toggles rapides (boutons on/off) :
├── 🌙 Mode sombre / clair
├── 🔔 Ne pas déranger
└── 🔊 Muet

Sliders :
└── Volume (si applicable — médias dans le navigateur)

Indicateurs (lecture seule, rafraîchis périodiquement) :
├── CPU usage (%)
├── RAM usage (used / total)
├── Disque usage (%)
├── Température CPU (si dispo)
├── IP du serveur
├── Uptime du serveur
└── Nombre de sessions actives

Actions :
├── Ouvrir les paramètres (Settings app)
├── Verrouiller la session
├── Se déconnecter
└── Info système rapide
```

### Implémentation technique
- Le backend du **shell** (custom-shell) expose des commandes système :
  - `get_system_info` → CPU, RAM, disk, temperature, IP, uptime
  - Ces infos sont récupérées via les API Linux (`/proc/stat`, `/proc/meminfo`, etc.)
- Rafraîchissement périodique (toutes les 5-10s) via un event stream ou polling
- Les toggles (dark mode, DND) sont des préférences utilisateur stockées via le module `state`

### État actuel ZRO
- ❌ Entièrement absent
- Le shell actuel n'a aucun indicateur système

---

## 8. Le système de thèmes

### Ce que c'est
La personnalisation visuelle globale de l'environnement.

### Composantes d'un système de thèmes

```
Thème global :
├── Mode clair / sombre (toggle global)
├── Couleur d'accent (libre ou palette prédéfinie)
├── Palette complète (fond, surface, texte, bordures, erreur, succès, warning)
├── Typographie (police principale, police mono, tailles)
├── Rayon des bordures (sharp/rounded/pill)
├── Densité de l'UI (compact/normal/spacious)
└── Fond d'écran (lié au thème ou indépendant)

Thèmes prédéfinis :
├── Catppuccin Mocha (sombre, actuel)
├── Catppuccin Latte (clair)
├── Nord (bleuté)
├── Dracula (violet)
├── Solarized (dark/light)
├── Tokyo Night
├── Gruvbox
├── One Dark
└── Custom (éditable par l'utilisateur)

Application du thème :
├── Via CSS custom properties (--zro-*)
├── Le shell applique les variables, les apps les héritent via l'iframe
├── Transition fluide entre thèmes (300ms transition sur les variables)
└── Persistance par utilisateur
```

### État actuel ZRO
- ✅ Design system via CSS variables (`zro-base.css`)
- ✅ Palette Catppuccin Mocha complète
- ❌ Pas de mode clair
- ❌ Pas de sélecteur de thème
- ❌ Pas de couleur d'accent configurable
- ❌ Pas de thèmes prédéfinis multiples
- ❌ Pas de personnalisation densité/radius/typographie

---

## 9. Le presse-papiers global

### Ce que c'est
Un clipboard partagé entre toutes les applications de l'environnement.

### Problématique dans un navigateur
Le navigateur isole les iframes. Le `clipboard` API (`navigator.clipboard`) nécessite :
- L'événement `focus` sur l'iframe
- La permission `clipboard-read` / `clipboard-write`
- L'interaction utilisateur (le clipboard API nécessite un geste utilisateur)

### Solution ZRO

```
Architecture :
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│  App A      │       │  Shell      │       │  App B      │
│  (iframe)   │──────▶│  Clipboard  │──────▶│  (iframe)   │
│  Ctrl+C     │       │  Manager    │       │  Ctrl+V     │
└─────────────┘       │  (parent)   │       └─────────────┘
                      └─────────────┘
```

**Le shell agit comme proxy clipboard :**
1. L'app capture Ctrl+C → récupère le texte sélectionné → envoie au shell via `postMessage`
2. Le shell reçoit `zro:clipboard:copy` → stocke dans sa mémoire + dans `navigator.clipboard`
3. L'app B fait Ctrl+V → demande au shell via `zro:clipboard:paste`
4. Le shell lit le clipboard → renvoie le contenu via `postMessage`

**Historique du clipboard :**
- Les 50 dernières entrées mémorisées
- Accessible via un panel dédié (Ctrl+Shift+V) ou via le tray
- Types supportés : texte, HTML, images (base64)

### État actuel ZRO
- ❌ Pas de clipboard manager (le clipboard navigateur fonctionne partiellement dans chaque iframe isolément)
- ❌ Pas de clipboard inter-applications
- Le SDK a un module `clipboard` mais pas exploité par le shell

---

## 10. Le glisser-déposer inter-applications

### Ce que c'est
La capacité de glisser un élément d'une app et de le déposer dans une autre.

### Cas d'usage

```
Exemples concrets :
├── Fichier du file manager → Terminal (cd vers le dossier ou cat du fichier)
├── Fichier du file manager → Notes (insérer le chemin ou le contenu)
├── Texte de Notes → Terminal (coller comme commande)
├── URL du navigateur → Bureau (créer un raccourci)
├── Image du navigateur → Bureau (sauvegarder en fichier)
└── Fichier du bureau → Mail (joindre en pièce jointe)
```

### Solution technique

```
DnD inter-iframe via le shell comme relai :

1. App source : démarre un drag → envoie `zro:dnd:start` au shell
   { type: "file", data: { path: "/home/dev/report.pdf", name: "report.pdf" } }

2. Shell : affiche un ghost element suivant le curseur, détecte la fenêtre cible

3. App cible : le shell envoie `zro:dnd:enter` puis `zro:dnd:drop`
   L'app cible gère le drop selon le type de données

4. Shell : nettoie le ghost element
```

### État actuel ZRO
- ❌ Aucun support de glisser-déposer inter-applications
- Le SDK a un module `dnd` mais non exploité

---

## 11. Les raccourcis clavier globaux

### Ce que c'est
Des combinaisons de touches capturées par le shell quel que soit le focus actuel.

### Raccourcis indispensables

| Raccourci | Action |
|-----------|--------|
| `Super` | Ouvrir/fermer le launcher |
| `Super + E` | Ouvrir le file manager |
| `Super + T` | Ouvrir un terminal |
| `Super + L` | Verrouiller la session |
| `Super + D` | Montrer le bureau (minimize tout) |
| `Super + ←/→` | Snap fenêtre gauche/droite |
| `Super + ↑` | Maximize |
| `Super + ↓` | Restore / minimize |
| `Alt + Tab` | Application switcher |
| `Alt + F4` | Fermer la fenêtre active |
| `Ctrl + Alt + T` | Nouveau terminal |
| `Ctrl + Alt + Del` | Session manager / sytem monitor |
| `Super + 1-9` | Lancer/focus le n-ième favori |
| `Super + Shift + S` | Capture d'écran |
| `PrtSc` | Capture d'écran plein écran |

### Problématique navigateur
Certains raccourcis sont capturés par le navigateur (`Ctrl+T`, `Ctrl+W`, `F5`, etc.) et ne peuvent pas être interceptés. Solutions :
- Utiliser `Super` (touche Meta) qui n'est pas capturée par le navigateur
- Utiliser des combinaisons inusitées par le navigateur
- Proposer une extension navigateur optionnelle pour capturer plus de raccourcis
- En mode plein écran (`F11`), plus de raccourcis sont disponibles

### État actuel ZRO
- ❌ Aucun raccourci clavier global
- Le SDK a un module `keybindings` mais non exploité

---

## 12. Le système de fichiers et associations MIME

### Ce que c'est
La capacité à associer des types de fichiers à des applications, et à ouvrir un fichier avec la bonne app.

```
Associations par défaut :
├── .txt, .md, .log         → Notes (éditeur de texte)
├── .jpg, .png, .gif, .webp → Image Viewer
├── .mp4, .webm, .mkv       → Video Player
├── .mp3, .flac, .ogg       → Audio Player
├── .pdf                     → PDF Viewer
├── .html, .url              → Web Browser
├── Répertoires              → File Manager
└── Exécutables              → Terminal (exécution)

"Ouvrir avec..." :
├── Clic droit → "Ouvrir avec" → liste des apps compatibles
├── App par défaut en gras
├── "Autre application..." → browse toutes les apps
└── "Toujours ouvrir avec..." → changement de l'association par défaut
```

### Implémentation dans ZRO
- Le manifeste de chaque app déclare les MIME types qu'elle supporte (`manifest.toml`)
- Le file manager interroge le registre pour connaître l'app par défaut
- Double-clic sur un fichier → le file manager demande au shell d'ouvrir l'app associée
- L'app reçoit le chemin du fichier en paramètre d'ouverture

### État actuel ZRO
- ❌ Aucun système d'association MIME
- Le file manager ouvre uniquement les fichiers texte dans son preview intégré
- Pas de "Ouvrir avec..."

---

## 13. L'écran de verrouillage

### Ce que c'est
L'écran qui s'affiche après un timeout d'inactivité ou un verrouillage manuel.

```
┌───────────────────────────────────────────────┐
│                                               │
│               🕐 15:42                        │
│           Mercredi 12 mars                    │
│                                               │
│              ┌───────────┐                    │
│              │    👤     │                    │
│              │   dev     │                    │
│              └───────────┘                    │
│                                               │
│         [••••••••••••        ]                │
│         Entrez votre mot de passe             │
│                                               │
│  🔔 3 notifications pendant le verrouillage   │
└───────────────────────────────────────────────┘
```

### Fonctionnalités
- Se déclenche après X minutes d'inactivité (configurable)
- `Super + L` pour verrouiller manuellement
- Affiche l'heure, la date, l'avatar et le nom de l'utilisateur
- Demande le mot de passe pour déverrouiller (authentification côté serveur)
- Affiche un résumé des notifications reçues pendant le verrouillage
- Fond d'écran spécifique (ou flou du bureau)
- Les applications continuent de tourner (pas de déconnexion)

### Implémentation
- Le shell affiche un overlay Z-index maximum couvrant tout l'écran
- L'overlay capture tous les événements clavier/souris
- Le déverrouillage fait un appel auth au backend (`POST /auth/verify`)
- Le timeout d'inactivité est détecté par le shell (mousemove/keydown listeners)

### État actuel ZRO
- ❌ Entièrement absent
- La session expire uniquement via le TTL du JWT

---

## 14. Les espaces de travail virtuels

### Ce que c'est
Des bureaux virtuels séparés, chacun avec ses propres fenêtres.

```
┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐
│ WS1 │  │ WS2 │  │ WS3 │  │  +  │
│ Dev │  │ Web │  │ Chat│  │ New │
└─────┘  └─────┘  └─────┘  └─────┘
   ▲ (actif)
```

### Fonctionnalités

```
Workspaces :
├── Nombre fixe (4 par défaut) ou dynamique (GNOME style)
├── Chaque workspace a ses propres fenêtres
├── Navigation : Ctrl+Alt+←/→ ou Super+scroll
├── Vue d'ensemble : Super (style GNOME Activities)
├── Déplacement de fenêtre : Super+Shift+←/→ ou drag dans la vue d'ensemble
├── Fenêtre sticky : visible sur tous les workspaces
├── Indicateur de workspace actif dans le panel
├── Nom et icône par workspace (personnalisable)
└── Animation slide horizontale entre workspaces
```

### Implémentation
- Chaque workspace est un container DOM avec ses propres fenêtres
- Un seul workspace visible (les autres ont `display: none`)
- Les fenêtres sticky sont dupliquées dans tous les containers (ou flottantes au-dessus)
- Le window manager maintient le mapping fenêtre → workspace
- Persistance : workspace assignment sauvegardé avec l'état des fenêtres

### État actuel ZRO
- ❌ Entièrement absent
- Un seul espace de travail

---

## 15. L'accessibilité

### Fonctionnalités minimales

```
Accessibilité :
├── Navigation clavier complète (Tab, Shift+Tab, Enter, Escape)
├── Rôles ARIA sur tous les composants (role="window", role="menu", etc.)
├── Labels ARIA sur les boutons icône
├── Contraste suffisant (ratio WCAG AA minimum)
├── Taille de texte ajustable (zoom global)
├── Réduction des animations (prefers-reduced-motion)
├── Focus visible (outline) sur tous les éléments interactifs
├── Lecteur d'écran compatible (aria-live pour les notifications)
└── High contrast mode
```

### État actuel ZRO
- ❌ Aucune fonctionnalité d'accessibilité volontaire
- La base CSS respecte un bon contraste (thème Catppuccin)
- Pas de navigation clavier, pas d'ARIA

---

## 16. Audit de l'existant ZRO

### Résumé : ce qui existe et ce qui manque

| Composante | État | Priorité |
|-----------|------|----------|
| Window manager (float) | ✅ Complet | — |
| Window persistence | ✅ Complet | — |
| Taskbar basique | ✅ Fonctionnel | 🔶 Améliorer |
| Launcher basique | ✅ Fonctionnel | 🔶 Améliorer |
| Horloge | ✅ Basique | 🔶 Améliorer |
| Design system (CSS vars) | ✅ Bon | 🔶 Améliorer |
| Notifications toast | ⚠️ Basique | 🔶 Améliorer |
| Pop-out windows | ✅ Complet | — |
| **Fond d'écran** | ❌ Absent | 🔴 Critique |
| **Window snapping/tiling** | ❌ Absent | 🔴 Critique |
| **System tray** | ❌ Absent | 🔴 Critique |
| **Paramètres rapides** | ❌ Absent | 🔴 Critique |
| **Centre de notifications** | ❌ Absent | 🔴 Critique |
| **Recherche dans le launcher** | ❌ Absent | 🔴 Critique |
| **Alt+Tab** | ❌ Absent | 🔴 Critique |
| **Raccourcis clavier** | ❌ Absent | 🔴 Critique |
| **Écran de verrouillage** | ❌ Absent | 🟡 Important |
| **Thèmes multiples** | ❌ Absent | 🟡 Important |
| **Presse-papiers inter-app** | ❌ Absent | 🟡 Important |
| **Menu contextuel bureau** | ❌ Absent | 🟡 Important |
| **Icônes de bureau** | ❌ Absent | 🟢 Nice to have |
| **Widgets de bureau** | ❌ Absent | 🟢 Nice to have |
| **Workspaces virtuels** | ❌ Absent | 🟢 Nice to have |
| **Drag-and-drop inter-app** | ❌ Absent | 🟢 Nice to have |
| **Associations MIME** | ❌ Absent | 🟢 Nice to have |
| **Animations fenêtres** | ❌ Absent | 🟢 Nice to have |
| **Accessibilité** | ❌ Absent | 🟢 Progressive |
