# Abysses

Un roguelike d’action pour téléphone, inspiré de la boucle de jeu de *Hades* : on traverse les Abysses salle après salle, en combat en temps réel. Les Anciens offrent des bénédictions qui transforment chaque coup. Chaque mort ramène au Sanctuaire, où l’on se renforce pour la descente suivante.

Le jeu tourne dans le navigateur, en 3D stylisée (three.js) : personnages en ombrage « cel » avec contours encrés, salles suspendues au-dessus d’un gouffre, braseros et lave. Aucun pixel art : les modèles, les textures et les icônes sont générés par le code. Il s’installe sur l’écran d’accueil et fonctionne ensuite hors connexion.

## Jouer sur ton téléphone

1. Publie le dépôt avec GitHub Pages : **Settings → Pages → Build and deployment → Deploy from a branch**, choisis la branche du jeu et le dossier `/ (root)`.
2. Ouvre l’adresse donnée par GitHub (du type `https://<utilisateur>.github.io/alana/`) sur le téléphone.
3. Ajoute-la à l’écran d’accueil :
   - iPhone (Safari) : bouton Partager → **Sur l’écran d’accueil** ;
   - Android (Chrome) : menu ⋮ → **Installer l’application**.

La descente est sauvegardée au début de chaque salle : si tu quittes, tu reprends au début de la salle en cours.

## Commandes

| Tactile | Clavier | Action |
| --- | --- | --- |
| Pouce sur la moitié gauche de l’écran | ZQSD, WASD ou flèches | Se déplacer (joystick flottant) |
| Bouton épée | Espace ou J | Attaque : trois coups enchaînés, garder appuyé pour enchaîner |
| Bouton tourbillon | K | Spécial : tourbillon qui frappe et repousse tout autour |
| Bouton flèche | Maj ou L | Esquive : bond invulnérable ; attaquer juste après donne un coup puissant |
| Bouton cristal | E ou I | Éclat : lance ton cristal, puis va le ramasser |
| Bouton pause | Échap ou P | Pause, bénédictions en cours, réglages |

La visée est assistée : l’attaque se tourne vers l’ennemi le plus proche dans la direction du joystick, ou tout autour de toi si tu ne le touches pas. Les zones **rouges au sol** annoncent les attaques ennemies.

## Une descente

- **Trois profondeurs de six salles** : quatre combats, une halte (fontaine et marchand), puis un gardien. Les Cryptes et la Sentinelle, les Grottes et le Roi des cavernes, les Forges et Vorgath le Wyrm.
- **Des portes à récompenses** : chaque porte annonce ce qu’elle cache (bénédiction, or, cœur de titan, fruit d’ambre, éclats d’âme, enclume) et s’ouvre une fois la récompense ramassée.
- **Six Anciens, 31 bénédictions** : la Tempête (éclairs en chaîne), la Braise (brûlure), le Givre (ralentit puis gèle), la Marée (repousse contre les murs), l’Ombre (coups critiques), le Vent (vitesse, esquives, éclats). Chaque bénédiction occupe l’attaque, le spécial, l’esquive, l’éclat ou un emplacement passif, avec quatre raretés.
- **Huit ennemis et trois boss**, chacun avec ses schémas d’attaque : rôdeurs, chauves-souris, archers, gelées qui se divisent, spectres, brutes, démons, plus des versions d’élite.
- **Le Sanctuaire** : les éclats d’âme achètent des pouvoirs permanents (PV, dégâts, critiques, sursis, esquive supplémentaire…) et débloquent l’Arc des Échos.

## Développement

Lancer un serveur local à la racine du dépôt, puis ouvrir `http://localhost:8000` :

```sh
python3 -m http.server 8000
```

Le code est découpé en scripts classiques qui partagent la portée globale, chargés dans cet ordre par `index.html` :

| Fichier | Rôle |
| --- | --- |
| `js/util.js` | Hasard, bus d’événements, stockage local protégé |
| `js/data.js` | Zones, héros, armes, ennemis, Anciens et bénédictions, boutique, améliorations |
| `js/gfx.js` | Textures peintes (sols, murs, lave, gouffre) et glyphes vectoriels de l’interface |
| `js/models.js` | Modèles 3D procéduraux : héros, ennemis, boss, décor |
| `js/room.js` | Plans des salles et collisions |
| `js/game.js` | Simulation : combat, IA des ennemis et des boss, bénédictions, récompenses, progression |
| `js/scene.js` | Rendu three.js : salles, animations, signalement des attaques, particules, caméra |
| `js/ui.js` | HUD, choix de bénédictions, marchand, Sanctuaire, écrans |
| `js/audio.js` | Effets sonores et musique générative (WebAudio), vibrations |
| `js/input.js` | Joystick tactile, boutons, clavier |
| `js/main.js` | Démarrage et boucle à pas fixe |

La simulation émet des événements (`Bus.emit('hit', …)`) que le rendu, l’interface et le son écoutent : les règles ne touchent jamais à la scène 3D ni au DOM.

Seule dépendance : [three.js](https://threejs.org/) r128, chargé depuis cdnjs et mis en cache par le service worker pour jouer hors connexion.

Outils :

- `node tools/build-single.mjs` produit `dist/abysses.html`, le jeu dans un seul fichier (three.js reste chargé depuis le CDN) ;
- `node tools/make-icons.cjs` régénère les icônes de l’application (nécessite Playwright).

Pense à changer `CACHE` dans `sw.js` quand tu modifies des fichiers, pour que les téléphones déjà installés récupèrent la nouvelle version.
