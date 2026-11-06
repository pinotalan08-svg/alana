# Abysses

Un roguelike d’action pour téléphone, inspiré de la boucle de jeu de *Hades* : on traverse les Abysses salle après salle, en combat en temps réel. Les Anciens offrent des bénédictions qui transforment chaque coup. Chaque mort ramène au Sanctuaire, où l’on se renforce pour la descente suivante.

Le jeu tourne dans le navigateur, en 3D stylisée (three.js) : personnages en ombrage « cel » avec contours encrés et reflets de contre-jour, salles suspendues au-dessus d’un gouffre, braseros et lave. Aucun pixel art : les modèles, les textures et les icônes sont générés par le code. Il s’installe sur l’écran d’accueil et fonctionne ensuite hors connexion.

Côté rendu :

- **Matériaux** : dalles, roche, glace, obsidienne et magma peints à la volée avec carte de relief, de rugosité et d’émission (les flaques des Grottes brillent, les joints des Forges rougeoient, les fissures du Glacier gardent une lueur froide, des runes violettes courent dans le Néant), frises et médaillon en métal incrusté au sol.
- **Lumière** : rendu HDR avec halo lumineux (*bloom*), étalonnage des couleurs, vignettage, ombres douces, lumières dynamiques pour les braseros, la lave et les explosions.
- **Effets** : traînée d’épée, arcs de coups, particules et fumée, rayons de lumière, brume et débris flottants au-dessus du gouffre, portails animés aux portes, bannières et cape qui ondulent.
- **Monstres** : apparition et mort par dissolution lumineuse, éclat blanc à l’impact, teinte glacée ou brûlante selon l’état.
- Le héros reste visible en silhouette quand un pilier le cache.
- Le réglage **Graphismes : économes** (menu pause) coupe le post-traitement et les ombres pour les téléphones modestes ; en mode élevé, la résolution s’adapte toute seule si les images ralentissent.

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
| Bouton de compétence (en haut à gauche des commandes) | A (Q sur QWERTY) ou U | Compétence choisie au Sanctuaire, avec un temps de recharge affiché sur le bouton |
| Bouton pause | Échap ou P | Pause, bénédictions en cours, réglages |

La visée est assistée : l’attaque se tourne vers l’ennemi le plus proche dans la direction du joystick, ou tout autour de toi si tu ne le touches pas. Les zones **rouges au sol** annoncent les attaques ennemies.

## Une descente

- **Cinq mondes de cinq salles** : trois combats, une halte (fontaine et marchand), puis un gardien. Les Cryptes et la Sentinelle, les Grottes et le Roi des cavernes, les Forges et Vorgath le Wyrm, le Glacier et Isolde la Reine du Givre, puis le Néant et le boss final, **Azhral le Dévoreur**, qui change de tactique en trois phases (rayons tournants, orbes chercheuses, anneaux, invocations).
- **Des portes à récompenses** : chaque porte annonce ce qu’elle cache (bénédiction, or, cœur de titan, fruit d’ambre, éclats d’âme, enclume) et s’ouvre une fois la récompense ramassée.
- **Six Anciens, 31 bénédictions** : la Tempête (éclairs en chaîne), la Braise (brûlure), le Givre (ralentit puis gèle), la Marée (repousse contre les murs), l’Ombre (coups critiques), le Vent (vitesse, esquives, éclats). Chaque bénédiction occupe l’attaque, le spécial, l’esquive, l’éclat ou un emplacement passif, avec quatre raretés.
- **Douze ennemis et cinq boss**, chacun avec ses schémas d’attaque : rôdeurs, chauves-souris, archers, gelées qui se divisent, spectres, brutes, démons, revenants gelés, golems de givre (pics de glace), ombres, yeux du Néant (rayons), plus des versions d’élite.
- **Quatre héros**, chacun avec ses statistiques, un trait et sa compétence :

  | Héros | Profil | Trait | Compétence |
  | --- | --- | --- | --- |
  | Kael, le Fils des Abysses | Polyvalent, 60 PV | Récupère 5 PV par salle conquise | Courroux céleste : la foudre frappe 6 ennemis |
  | Sira, la Lame d’ombre | Rapide, 46 PV, +1 esquive | +8 % de critique, critiques à ×3,6 | Voile d’ombre : 3 s intouchable, coups critiques |
  | Brann, le Rempart | Lent, 84 PV, +15 % de dégâts | −20 % de dégâts subis, jamais repoussé | Égide : bouclier de 4 s qui explose |
  | Maëlis, l’Oracle des marées | Mage, 52 PV, +1 éclat | Éclats +60 % de dégâts, qui reviennent seuls | Hiver éternel : gèle tout autour |

- **Six compétences** à équiper (une par descente) : les quatre des héros, plus Météore et Second souffle à débloquer.
- **Quatre difficultés** : Clémente, Normale, Ardue et Cauchemar (débloquée après une victoire). Elles changent la robustesse, la force et la vitesse des monstres, le nombre d’élites, les soins de la fontaine et les éclats d’âme gagnés.
- **Le Sanctuaire** : les éclats d’âme débloquent les héros, les compétences, l’Arc des Échos et des pouvoirs permanents (PV, dégâts, critiques, sursis, esquive supplémentaire, recharge de compétence…). Les portraits des héros sont rendus à partir de leurs modèles 3D.

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
| `js/gfx.js` | Outils de dessin, halos et glyphes vectoriels de l’interface |
| `js/textures.js` | Matériaux procéduraux (couleur, relief, rugosité, émission), incrustations, textures d’effets |
| `js/models.js` | Modèles 3D procéduraux (héros, ennemis, boss, décor) et leurs shaders : contre-jour, éclat, dissolution |
| `js/room.js` | Plans des salles et collisions |
| `js/game.js` | Simulation : combat, IA des ennemis et des boss, bénédictions, récompenses, progression |
| `js/post.js` | Post-traitement : rendu HDR, halo lumineux, étalonnage, vignettage, effets de dégâts |
| `js/scene.js` | Rendu three.js : salles, animations, signalement des attaques, particules, traînées, caméra |
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
