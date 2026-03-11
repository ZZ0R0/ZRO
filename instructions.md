# ZRO — Instructions maîtres pour GitHub Copilot

## Rôle de ce document

Ce document sert de **générateur d'instructions**, de **générateur de planification**, et de **générateur de cahiers des charges** pour le projet **zro**.

Il ne faut **pas** essayer de tout coder immédiatement à partir de ce seul fichier.

Le flux attendu est le suivant :

1. **Copilot run 1** : analyser ce document, structurer le projet, produire les fichiers Markdown de planification, de spécification, de découpage, d’architecture, de sécurité, de protocole, de conventions, de backlog et d’orchestration.
2. **Copilot run 2** : exécuter les instructions produites au run 1 et implémenter l’ensemble du projet de façon sérieuse, testée, documentée et exploitable.
3. Les runs suivants servent à raffiner, corriger, compléter, stabiliser et durcir jusqu’à obtenir un projet fonctionnel, propre, cohérent et maintenable.

---

# 1. Intention produit

## 1.1 Nom du projet

Le projet s’appelle :

```text
zro
```

## 1.2 Vision

**zro** est un framework applicatif **remote-first** pour Linux/Debian.

Le but n’est **pas** de construire un environnement de bureau complet dans l’immédiat.

Le but est de construire une **plateforme applicative fonctionnelle** permettant d’exécuter et de servir des applications de la façon suivante :

- chaque application possède son **backend dédié**, isolé, tournant dans son **propre processus** sur la machine hôte ;
- chaque application possède un **frontend web** en **HTML/CSS/JS** ;
- un **runtime central** sur l’hôte assure :
  - l’exposition HTTP/HTTPS ;
  - la gestion des sessions ;
  - le routage vers les applications ;
  - le service des assets frontend ;
  - le transport des événements interactifs ;
  - le pont entre le navigateur client et les backends applicatifs ;
- l’accès principal se fait via **navigateur web** ;
- le mode de développement visé en premier est **Docker Compose** ;
- le projet doit être pensé proprement dès le départ pour éviter la dette technique.

---

# 2. Ce qu’il faut faire au run 1

Le **run 1** ne doit pas coder toute l’application.

Le **run 1** doit produire une base documentaire interne complète qui servira de référence stricte pour l’implémentation.

Copilot doit générer un ensemble cohérent de fichiers Markdown dans le dépôt, afin d’orchestrer le projet proprement.

## 2.1 Objectif du run 1

Créer les documents suivants, ou leur équivalent si Copilot estime qu’une variante est mieux structurée :

```text
/docs/
  00-vision.md
  01-product-scope.md
  02-architecture-overview.md
  03-runtime-gateway-spec.md
  04-app-backend-sdk-spec.md
  05-web-frontend-spec.md
  06-routing-url-uri-spec.md
  07-ipc-protocol-spec.md
  08-auth-session-security-spec.md
  09-permissions-sandboxing-spec.md
  10-dev-environment-docker-compose-spec.md
  11-repository-structure.md
  12-coding-standards.md
  13-testing-strategy.md
  14-observability-spec.md
  15-release-strategy.md
  16-roadmap.md
  17-backlog.md
  18-risk-register.md
  19-apps-reference-spec.md
  20-implementation-order.md
  21-acceptance-criteria.md
  22-contributor-guide.md
  23-open-questions-and-decisions.md
```

## 2.2 Exigence sur le run 1

Les documents du run 1 doivent :

- être **concrets** et pas décoratifs ;
- contenir des **choix techniques argumentés** ;
- préciser les **interfaces entre composants** ;
- définir les **invariants** ;
- définir les **limites de périmètre** ;
- contenir les **questions ouvertes** et les décisions provisoires ;
- transformer les ambiguïtés en décisions rationnelles, **sans bloquer** ;
- privilégier la **scalabilité**, la **stabilité**, la **maintenabilité**, la **sécurité** et la **cohérence d’architecture** ;
- être suffisamment précis pour qu’un run suivant puisse coder le projet sans repartir de zéro.

## 2.3 Exigence importante

Quand une précision n’est pas fournie explicitement dans ce document, Copilot doit :

- faire des hypothèses **raisonnables** ;
- les **documenter clairement** ;
- choisir une direction **cohérente** avec la vision du projet ;
- éviter les choix “rapides” qui créent de la dette ;
- éviter de multiplier les frameworks et sous-systèmes inutilement.

---

# 3. Ce qu’il faut faire au run 2

Le **run 2** doit implémenter le projet à partir des documents du run 1.

Il ne doit pas se limiter à un POC fragile.

Il doit viser un **projet fonctionnel**, propre, testé, documenté, lançable localement avec Docker Compose.

## 3.1 Livrables attendus au run 2

Copilot doit générer :

- le code source complet ;
- les manifests ;
- les Dockerfiles ;
- le fichier `docker-compose.yml` ou équivalent moderne ;
- les scripts de développement ;
- les scripts de test ;
- les fichiers de configuration ;
- la documentation utilisateur et développeur ;
- les tests unitaires ;
- les tests d’intégration ;
- les exemples d’applications ;
- les conventions de build ;
- les README par composant ;
- les fichiers de bootstrap si nécessaires ;
- les exemples de manifests applicatifs ;
- les schémas de protocoles et de flux si utiles.

## 3.2 Qualité exigée

Le run 2 doit viser :

- un projet exécutable ;
- une structure propre ;
- une architecture cohérente ;
- des tests substantiels ;
- une documentation exploitable ;
- une capacité de debug correcte ;
- un démarrage reproductible ;
- une base saine pour la suite.

---

# 4. Périmètre fonctionnel initial

## 4.1 Ce que zro doit être au départ

zro doit être un **framework de serving d’applications remote-first**.

Il doit fournir au minimum :

- un **runtime central** ;
- un **gateway HTTP/HTTPS** ;
- un **broker d’événements interactifs** ;
- un **registre d’applications** ;
- un **système de manifests applicatifs** ;
- un **mécanisme de lancement / arrêt / supervision** des backends applicatifs ;
- un **modèle d’URL stable** ;
- un **accès par navigateur** ;
- un **frontend HTML/CSS/JS par application** ;
- un **canal temps réel** pour les interactions ;
- une **base de permissions applicatives** ;
- une **intégration Docker Compose** pour le développement.

## 4.2 Ce que zro ne doit pas être au départ

Ne pas dériver vers :

- un environnement de bureau complet ;
- un compositor graphique Linux ;
- un clone de Wayland ou X11 ;
- un système de rendu pixel/vidéo ;
- un clone de RDP/VNC ;
- un orchestrateur Kubernetes ;
- un moteur 3D ;
- une solution “HTML only” dogmatique pour tous les futurs cas ;
- un framework frontend monolithique imposé à toutes les apps ;
- un monolithe où toute la logique applicative est fusionnée dans le runtime central.

---

# 5. Architecture cible de haut niveau

## 5.1 Modèle général

L’architecture cible doit suivre ce principe :

```text
Client navigateur
    ↕
zro gateway / runtime host
    ↕
backends applicatifs isolés (un processus par app)
```

## 5.2 Règles d’architecture non négociables

1. **Une app = un backend dédié = un processus dédié**.
2. Le **runtime central** est le **point d’entrée réseau unique**.
3. Les apps ne doivent **pas être exposées directement** au réseau externe.
4. Les assets frontend des apps sont servis via le **gateway**.
5. Les interactions temps réel passent via un canal standardisé.
6. Le système doit être pensé pour Linux/Debian en priorité.
7. Le mode de développement de référence est **Docker Compose**.
8. Le projet doit être structuré pour pouvoir évoluer ensuite vers des usages plus riches sans casser les fondations.

---

# 6. Stack technologique de référence

Copilot peut ajuster certains choix si nécessaire, mais doit rester proche de cette direction.

## 6.1 Langage principal backend

Utiliser **Rust** comme langage principal pour :

- le runtime central ;
- le gateway ;
- le SDK backend des applications ;
- les backends applicatifs de référence.

## 6.2 Frontend

Utiliser :

- **HTML**
- **CSS**
- **JavaScript** ou **TypeScript**

Le choix d’un framework frontend doit rester modéré.  
Ne pas imposer une dépendance lourde si elle n’apporte pas de bénéfice structurel clair.

## 6.3 Réseau

Pour la v1 :

- HTTP/HTTPS pour les ressources et appels standards ;
- WebSocket pour le temps réel et les événements interactifs.

Ne pas partir immédiatement sur QUIC/WebTransport sauf justification forte et documentée.

## 6.4 IPC local

Privilégier :

- **Unix domain sockets** pour la communication locale entre le runtime central et les backends applicatifs.

Si Copilot choisit temporairement du loopback TCP pour des raisons de simplification de développement, cela doit être :

- explicitement justifié ;
- encapsulé ;
- prévu pour être remplaçable facilement.

## 6.5 Conteneurisation

Le mode de développement doit être basé sur :

- **Docker**
- **Docker Compose**

Le projet doit être lançable facilement pour le développement et les tests locaux.

---

# 7. Modèle exact à implémenter

## 7.1 Backend applicatif

Chaque application doit avoir :

- son propre processus ;
- sa propre logique métier ;
- son propre état ;
- son propre manifeste ;
- son frontend associé ;
- un contrat clair avec le runtime central.

## 7.2 Runtime central

Le runtime central doit fournir :

- chargement des manifests ;
- registre des apps ;
- supervision des apps ;
- reverse proxy interne ;
- gestion des sessions ;
- auth de base ;
- service des assets ;
- canal d’événements ;
- routage vers la bonne application ;
- observabilité minimale.

## 7.3 Frontends d’applications

Chaque app doit avoir un frontend web :

- servi via le gateway ;
- accessible via URL ;
- couplé proprement à son backend ;
- rendu dans un navigateur standard.

Le projet ne doit pas dépendre d’une webview propriétaire au départ.

---

# 8. Routing, URL et URI

## 8.1 Objectif

Définir un schéma d’accès stable, propre, simple et extensible.

## 8.2 Proposition de base à raffiner

Copilot doit partir d’une structure de ce type, sauf meilleure justification :

```text
/apps
/a/{app-slug}/
/a/{app-slug}/i/{instance-id}/
/a/{app-slug}/i/{instance-id}/ws
/a/{app-slug}/static/{path}
```

## 8.3 Identité

Copilot doit séparer explicitement :

- **app_id** : identité stable interne ;
- **slug** : identité lisible pour l’URL ;
- **instance_id** : identité d’exécution.

Ne jamais mélanger ces concepts.

## 8.4 URI internes

Copilot doit réfléchir à un schéma interne de type URI applicative pour permettre plus tard :

- communication inter-applications ;
- références internes ;
- navigation profonde ;
- sérialisation propre des cibles applicatives.

Cette partie doit être spécifiée proprement au run 1.

---

# 9. Manifests applicatifs

Chaque application doit être décrite par un manifeste.

Le manifeste doit contenir au minimum :

- identité de l’app ;
- version ;
- slug ;
- exécutable backend ;
- configuration frontend ;
- mode de transport local ;
- permissions ;
- variables de configuration utiles ;
- éventuellement dépendances ou capacités déclarées.

Copilot doit définir une spec TOML propre.

---

# 10. Sécurité, permissions et isolation

## 10.1 Priorité

Même en développement, la base du projet doit intégrer une réflexion sécurité propre.

## 10.2 Exigences minimales

Le système doit au minimum prévoir :

- séparation des processus ;
- limitation de l’exposition réseau ;
- contrôle d’accès aux apps ;
- permissions déclaratives ;
- base d’authentification/session ;
- contrôle des origines et des canaux interactifs ;
- journalisation minimale des accès et erreurs ;
- validation stricte des messages.

## 10.3 Important

Le runtime central peut avoir plus de privilèges, mais ne doit pas devenir un monolithe applicatif.

Les apps doivent rester isolées.

---

# 11. Environnement de développement

## 11.1 Cible principale

La priorité immédiate est un environnement de développement **Docker Compose** propre.

## 11.2 Ce qu’il faut fournir

Copilot doit produire une expérience de dev reproductible avec :

- build simple ;
- lancement simple ;
- hot reload ou équivalent raisonnable si possible ;
- logs lisibles ;
- structure documentaire claire ;
- tests exécutables facilement.

## 11.3 Production

Le run 1 doit documenter ce qui serait nécessaire pour aller vers un mode prod-ready, mais le run 2 peut donner la priorité au mode développement robuste via Docker Compose.

Le but n’est pas de faire du bricolage jetable : la structure doit rester propre et évolutive.

---

# 12. Applications de référence obligatoires

Pour valider le framework, Copilot doit générer plusieurs applications d’exemple réelles.

Ces apps sont obligatoires, sauf argument technique très fort.

## 12.1 App 1 — Notes / éditeur texte

Objectifs :

- valider les formulaires ;
- valider la logique de sauvegarde ;
- valider les échanges frontend/backend ;
- valider les manifests et le routing.

## 12.2 App 2 — Explorateur de fichiers simplifié

Objectifs :

- valider la navigation hiérarchique ;
- valider les permissions ;
- valider les actions contextuelles ;
- valider les flux de données structurés.

## 12.3 App 3 — Terminal web

Objectifs :

- valider le temps réel ;
- valider la latence interactive ;
- valider clavier / copier-coller / flux continus ;
- valider la solidité de l’architecture.

Copilot peut ajouter d’autres apps de démonstration si cela renforce la plateforme, mais ces trois-là doivent exister.

---

# 13. Clic droit, interactions et UX applicative

Le système doit être capable de supporter au minimum, côté application web :

- clic gauche ;
- clic droit ;
- double clic ;
- clavier ;
- focus / blur ;
- sélection ;
- scroll ;
- copier / coller ;
- menus contextuels gérés applicativement si nécessaire.

Copilot doit intégrer cette exigence dans :

- la spec frontend ;
- la stratégie d’événements ;
- les apps de référence.

---

# 14. Observabilité et qualité

Copilot ne doit pas générer un projet opaque.

Il faut prévoir dès le départ :

- logs structurés côté runtime ;
- logs utiles côté apps ;
- traçage minimal des erreurs ;
- documentation de debug ;
- tests unitaires ;
- tests d’intégration ;
- validation de configuration ;
- vérifications lint / format ;
- scripts CI locaux ou reproductibles.

---

# 15. Structure de dépôt attendue

Copilot doit proposer puis générer une structure de dépôt claire, par exemple :

```text
zro/
  README.md
  LICENSE
  .gitignore
  docker-compose.yml
  /docs
  /runtime
  /gateway
  /sdk
  /apps
    /notes
    /files
    /terminal
  /tests
  /scripts
  /configs
```

La structure exacte peut évoluer, mais elle doit rester lisible, modulaire et maintenable.

---

# 16. Standards de code et de documentation

Copilot doit définir puis appliquer :

- conventions de nommage ;
- conventions de modules ;
- gestion des erreurs ;
- journalisation ;
- niveaux de tests ;
- conventions de commits si utile ;
- style de documentation ;
- exemples d’usage ;
- README globaux et README par composant.

---

# 17. Backlog et ordre d’implémentation

Au run 1, Copilot doit produire un **ordre d’implémentation détaillé**.

Cet ordre doit être rationnel.

Exemple de logique attendue :

1. base du dépôt ;
2. docs d’architecture ;
3. manifeste applicatif ;
4. registre des apps ;
5. gateway minimal ;
6. service des assets frontend ;
7. transport WebSocket ;
8. SDK backend ;
9. app Notes ;
10. app Files ;
11. app Terminal ;
12. tests ;
13. hardening ;
14. docs finales.

L’ordre exact peut être amélioré, mais il doit être explicite.

---

# 18. Exigence de rigueur sur les ambiguïtés

Quand un point n’est pas complètement défini, Copilot doit :

- choisir une direction raisonnable ;
- l’écrire noir sur blanc ;
- l’ajouter à un registre de décisions ;
- éviter de laisser des trous silencieux dans l’architecture.

---

# 19. Ce que Copilot doit éviter

Copilot ne doit pas :

- faire un POC jetable ;
- générer une stack incohérente ;
- sur-ingénierer sans raison ;
- multiplier les dépendances inutilement ;
- fusionner toutes les apps dans un backend unique ;
- exposer chaque app directement sur un port public ;
- sauter les tests ;
- produire une doc purement décorative ;
- rester vague sur l’architecture ;
- ignorer les aspects sécurité et isolation ;
- dévier vers un desktop complet.

---

# 20. Exigence finale sur le run 2 et les runs suivants

L’objectif n’est pas de produire du faux progrès.

L’objectif est d’obtenir :

- un projet fonctionnel ;
- un cadre propre ;
- des choix d’architecture défendables ;
- un dépôt clair ;
- des applications de référence utiles ;
- une base suffisamment robuste pour une suite sérieuse.

Chaque run doit chercher à réduire :

- l’ambiguïté ;
- la dette technique ;
- les zones non testées ;
- les parties non documentées.

---

# 21. Prompt opératoire à suivre par Copilot

Copilot doit suivre les instructions ci-dessous.

## Étape A — run 1

Lis ce document comme un **brief maître**.

Produis tous les fichiers Markdown nécessaires pour :

- transformer ce brief en architecture complète ;
- découper le projet en composants ;
- définir les specs ;
- produire les cahiers des charges internes ;
- préciser les interfaces ;
- préciser les protocoles ;
- préciser le schéma de manifests ;
- préciser la structure du dépôt ;
- préciser les conventions ;
- préciser les tests ;
- préciser le plan d’implémentation.

Tu dois documenter les hypothèses quand une précision manque.

Tu dois privilégier des choix techniques propres, stables, cohérents et réalistes pour un projet Rust + frontends web + runtime central + Docker Compose.

Le résultat du run 1 doit être une base documentaire exploitable directement au run 2.

## Étape B — run 2

En t’appuyant strictement sur les documents générés au run 1, implémente le projet complet :

- code source ;
- manifests ;
- runtime central ;
- gateway ;
- SDK ;
- apps de référence ;
- Docker Compose ;
- scripts ;
- tests ;
- documentation.

Le résultat doit être un projet réellement lançable et exploitable localement.

## Étape C — validation continue

À chaque étape, vérifie :

- cohérence d’architecture ;
- séparation des responsabilités ;
- qualité des interfaces ;
- qualité des logs ;
- qualité des tests ;
- lisibilité du dépôt ;
- conformité avec la vision du projet.

---

# 22. Résultat attendu au terme de l’orchestration

À l’issue du processus, le dépôt **zro** doit contenir :

- une architecture claire ;
- une documentation complète ;
- une implémentation réelle ;
- un environnement de dev Docker Compose ;
- un runtime central ;
- plusieurs apps distantes fonctionnelles ;
- des tests ;
- un niveau de qualité professionnel ;
- une base saine pour les itérations suivantes.

---

# 23. Instruction finale

Ne traite pas ce document comme une simple note.

Traite-le comme :

- un **mandat de conception** ;
- un **mandat de structuration** ;
- un **mandat d’orchestration** ;
- un **mandat d’implémentation progressive**.

Tu dois transformer ce brief en dépôt sérieux.

Quand une décision manque, tranche proprement, documente-la, puis continue.

Le succès n’est pas de générer vite.  
Le succès est de générer **juste, propre, cohérent, testable et maintenable**.
