# Abysses

Un roguelike de poche pensé pour le téléphone : dix étages générés au hasard, des monstres qui dorment ou te traquent, des coffres (parfois piégés), et Vorgath le Wyrm qui t’attend tout au fond. Une seule vie.

On joue en **vue à la troisième personne** : la caméra se tient derrière le héros et pivote pour suivre son regard, dans un donjon en 3D éclairé à la torche, peuplé de personnages en pixel art. Une vue du dessus est disponible dans le menu Pause.

Le jeu tourne dans le navigateur, sans étape de compilation. Il s’installe sur l’écran d’accueil comme une application et fonctionne ensuite hors connexion.

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
| Glisser le doigt | Un pas dans l’une des 8 directions (vers le haut = droit devant en vue 3D) |
| Appui long | Décrire ce qui se trouve sur la case |
| Toucher un objet de la besace | Voir sa description, puis l’utiliser |
| Bouton **Attendre** | Passer un tour, ou se reposer si aucun ennemi n’est en vue |
| Bouton **Descendre** | Prendre l’escalier quand on est dessus |

Au clavier : flèches, ZQSD ou WASD, pavé numérique (diagonales), espace pour attendre, Entrée pour descendre, 1 à 6 pour la besace, Échap pour la pause. En vue 3D, les directions sont relatives à la caméra : « haut » fait avancer.

Le menu Pause bascule entre la vue à la troisième personne et la vue du dessus. Si le téléphone ne gère pas WebGL, le jeu passe tout seul en vue du dessus.

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
| `js/render.js` | Vue du dessus (canvas 2D), particules et nombres flottants partagés |
| `js/render3d.js` | Vue à la troisième personne (three.js) : décor instancié, caméra qui suit le héros, lumières |
| `js/ui.js` | Interface, écrans, besace |
| `js/audio.js` | Effets sonores synthétisés (WebAudio) et vibrations |
| `js/input.js` | Toucher, glisser, clavier, déplacement automatique |
| `js/main.js` | Démarrage et boucle d’animation |

La logique émet des événements (`Bus.emit('damage', …)`) que le rendu, l’interface et le son écoutent : les règles ne touchent jamais au DOM.

Seule dépendance : [three.js](https://threejs.org/) r128, chargé depuis cdnjs et mis en cache par le service worker pour le jeu hors connexion.

Outils :

- `node tools/build-single.mjs` produit `dist/abysses.html`, le jeu complet dans un seul fichier (pratique pour l’envoyer ou y jouer sans serveur) ;
- `node tools/make-icons.cjs` régénère les icônes de l’application à partir du sprite du héros (nécessite Playwright).

Pense à changer `CACHE` dans `sw.js` quand tu modifies des fichiers, pour que les téléphones déjà installés récupèrent la nouvelle version.
