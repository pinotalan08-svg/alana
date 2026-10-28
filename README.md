# Abysses

Un roguelike de poche pensé pour le téléphone : dix étages générés au hasard, des monstres qui dorment ou te traquent, des coffres (parfois piégés), et Vorgath le Wyrm qui t’attend tout au fond. Une seule vie.

Le jeu tourne dans le navigateur, sans dépendance ni étape de compilation. Il s’installe sur l’écran d’accueil comme une application et fonctionne ensuite hors connexion.

## Jouer sur ton téléphone

1. Publie le dépôt avec GitHub Pages : **Settings → Pages → Build and deployment → Deploy from a branch**, choisis la branche du jeu et le dossier `/ (root)`.
2. Ouvre l’adresse donnée par GitHub (du type `https://<utilisateur>.github.io/alana/`) sur le téléphone.
3. Ajoute-la à l’écran d’accueil :
   - iPhone (Safari) : bouton Partager → **Sur l’écran d’accueil** ;
   - Android (Chrome) : menu ⋮ → **Installer l’application**.

La partie est sauvegardée à chaque tour : tu peux fermer l’appli et reprendre plus tard.

## Commandes

| Geste | Action |
| --- | --- |
| Toucher une case | S’y rendre (le héros s’arrête si un ennemi apparaît) |
| Toucher un monstre adjacent | L’attaquer |
| Glisser le doigt | Un pas dans l’une des 8 directions |
| Appui long | Décrire ce qui se trouve sur la case |
| Toucher un objet de la besace | Voir sa description, puis l’utiliser |
| Bouton **Attendre** | Passer un tour, ou se reposer si aucun ennemi n’est en vue |
| Bouton **Descendre** | Prendre l’escalier quand on est dessus |

Au clavier : flèches, ZQSD ou WASD, pavé numérique (diagonales), espace pour attendre, Entrée pour descendre, 1 à 6 pour la besace, Échap pour la pause.

## Ce qu’on trouve en bas

- **Trois ambiances** : les Cryptes (étages 1 à 3), les Grottes (4 à 6, cavernes organiques), les Forges (7 à 9), puis le Repaire du Wyrm.
- **11 monstres** aux comportements différents : chauves-souris erratiques, gelées lentes, squelettes archers, loups rapides, spectres qui traversent les murs, trolls qui se régénèrent, démons lanceurs de feu, mimiques déguisées en coffres.
- **Objets** : potions de soin, élixirs de force et de vigueur, parchemins de feu, de téléportation et de clairvoyance, cinq armes et cinq armures (la meilleure s’équipe toute seule).
- **Progression** : niveaux d’expérience, attaques sournoises sur les monstres endormis, coups critiques.
- **Score** : or + 100 par étage atteint + 10 par ennemi vaincu (+2000 en cas de victoire), avec un tableau des meilleurs scores.

## Développement

Lancer un serveur local à la racine du dépôt, puis ouvrir `http://localhost:8000` :

```sh
python3 -m http.server 8000
```

Le code est découpé en scripts classiques qui partagent la portée globale, chargés dans cet ordre par `index.html` :

| Fichier | Rôle |
| --- | --- |
| `js/util.js` | Hasard, géométrie, bus d’événements, stockage local protégé |
| `js/data.js` | Monstres, objets, thèmes, courbe d’expérience |
| `js/sprites.js` | Pixel art (écrit en texte) et textures de tuiles procédurales |
| `js/map.js` | Génération (salles et couloirs, cavernes, arène du boss), champ de vision |
| `js/game.js` | Règles : tours, combat, IA, objets, score, sauvegarde |
| `js/render.js` | Rendu canvas : caméra, éclairage à la torche, particules |
| `js/ui.js` | Interface, écrans, besace |
| `js/audio.js` | Effets sonores synthétisés (WebAudio) et vibrations |
| `js/input.js` | Toucher, glisser, clavier, déplacement automatique |
| `js/main.js` | Démarrage et boucle d’animation |

La logique émet des événements (`Bus.emit('damage', …)`) que le rendu, l’interface et le son écoutent : les règles ne touchent jamais au DOM.

Outils :

- `node tools/build-single.mjs` produit `dist/abysses.html`, le jeu complet dans un seul fichier (pratique pour l’envoyer ou y jouer sans serveur) ;
- `node tools/make-icons.cjs` régénère les icônes de l’application à partir du sprite du héros (nécessite Playwright).

Pense à changer `CACHE` dans `sw.js` quand tu modifies des fichiers, pour que les téléphones déjà installés récupèrent la nouvelle version.
