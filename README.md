# CarbuVision Web

Application web progressive (PWA) pour comparer des prix de carburants, exploiter des prévisions, localiser les stations et évaluer la rentabilité d’un détour. Elle fonctionne sur iPhone/iPad, Android, macOS, Windows et Linux via navigateur moderne.

## Fichiers à publier ensemble

- `index.html`
- `styles.css`
- `app.js`
- `manifest.json`
- `sw.js`
- `icon.svg`

Conservez exactement ces noms et placez tous les fichiers à la racine du même dossier. Ne lancez pas simplement `index.html` en double-cliquant dessus : la carte et l’installation PWA demandent un serveur HTTP(S).

## Utilisation

1. Publiez les six fichiers sur un hébergement HTTPS.
2. Ouvrez l’adresse du site dans Safari, Chrome ou Edge.
3. Dans l’onglet **Données**, récupérez depuis data.gouv.fr l’adresse de téléchargement finale de la ressource CSV ou JSON, puis collez-la dans l’application.
4. Si le navigateur signale un blocage CORS, téléchargez le fichier depuis data.gouv.fr puis utilisez **Choisir un CSV ou JSON téléchargé**. Cette méthode ne dépend pas de CORS.
5. Autorisez la localisation seulement si vous voulez trier et filtrer selon la distance.

L’application reconnaît automatiquement plusieurs noms de colonnes courants (par exemple `latitude`, `longitude`, `ville`, `enseigne`, `carburant`, `prix`, `prix_predit`, `confidence`). Elle accepte aussi un format large, tel que `gazole_prix`, `sp98_prix` et leurs variantes de prévision.

## Installation sur iPhone

1. Ouvrez l’URL HTTPS dans **Safari**.
2. Touchez Partager.
3. Choisissez **Sur l’écran d’accueil**.
4. Validez `CarbuVision`.

L’outil s’ouvre alors sans barre d’adresse, comme une application. Les fichiers de l’application et les dernières données importées sont mis en cache localement. Une carte en ligne reste nécessaire pour afficher les tuiles cartographiques OpenStreetMap.

## Publication gratuite — Cloudflare Pages

La méthode la plus simple :

1. Créez un compte Cloudflare.
2. Ouvrez **Workers & Pages**, puis **Create application** et **Pages**.
3. Créez un projet par dépôt GitHub, ou utilisez l’import direct des fichiers si proposé.
4. Déposez les six fichiers à la racine du projet.
5. Publiez : Cloudflare fournit une URL HTTPS que vous pouvez ouvrir sur iPhone.

## Publication gratuite — GitHub Pages

1. Créez un dépôt GitHub, par exemple `carbuvision`.
2. Ajoutez les six fichiers à la racine de la branche `main`.
3. Dans `Settings > Pages`, sélectionnez le déploiement depuis la branche `main` et le dossier `/root`.
4. GitHub affiche l’URL HTTPS de publication.

## Vie privée et données locales

- Les favoris, le profil véhicule, le thème, l’URL de source et le cache sont enregistrés dans le stockage local du navigateur.
- La position est uniquement utilisée côté navigateur pour le calcul de distance.
- L’application n’envoie aucune position à CarbuVision.
- Les tuiles de carte sont chargées depuis OpenStreetMap lorsque la carte est consultée.

## Limites connues

- Les prévisions restent des estimations, jamais une garantie de prix.
- Une URL de fichier peut être refusée par le navigateur lorsque l’éditeur de données n’autorise pas le partage CORS. L’import manuel du fichier est la solution de repli prévue.
- Les notifications fiables lorsque l’application est entièrement fermée demandent un backend et des notifications Web Push ; cette version reste volontairement sans compte et sans serveur.
- L’application importe les données disponibles dans le fichier. Si le fichier de prévision ne contient pas de coordonnées ou de prix par station, la liste correspondante ne peut pas être localisée.

## Améliorations futures

- API proxy serverless pour normaliser automatiquement les fichiers et éviter CORS.
- Fusion avec un flux de prix instantanés officiel.
- Historique quotidien en base de données et graphiques.
- Comptes facultatifs pour synchroniser favoris et véhicules.
- Alertes Web Push, déclenchées par un service planifié.
- Déploiement Capacitor si une version App Store/Google Play devient nécessaire.
