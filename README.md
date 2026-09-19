# Glaneur

Créez des flux RSS pour les sites qui n’en proposent pas. Glaneur analyse une page, repère la liste des articles et vous laisse désigner titres, liens et dates d’un clic, comme avec un surligneur. Il tourne chez vous — pensé pour un conteneur LXC Proxmox — et vous en êtes le seul utilisateur.

## Ce que fait Glaneur

- **Analyse d’une adresse.** Collez une URL : Glaneur signale les flux que le site publie déjà, propose une recette si la plateforme est connue et détecte les listes d’articles avec leurs champs (titre, lien, résumé, date, image, auteur).
- **Sélection visuelle.** La page s’affiche dans l’éditeur. Choisissez un champ puis cliquez dessus dans la page : Glaneur généralise la sélection à tous les articles. Chaque champ a sa couleur de surligneur, qu’on retrouve dans l’aperçu du flux. Les sélecteurs CSS restent modifiables à la main.
- **Rendu JavaScript.** Pour les sites construits en JavaScript, la page peut être rendue par Chromium (facultatif).
- **API JSON.** Reliez une API — ou le JSON intégré à une page, comme `script#__NEXT_DATA__` — en cliquant dans l’arbre des données. Les modèles comme `https://site.fr/{{slug}}` combinent plusieurs valeurs.
- **Surveillance d’une page.** Un article est publié quand une zone change, avec les lignes ajoutées et retirées.
- **Flux existants.** Fusionnez plusieurs flux, filtrez-les, récupérez le texte complet des articles.
- **Recettes.** YouTube (Shorts exclus au choix), Telegram, Bluesky, Mastodon, Reddit, GitHub (versions, tags, commits), Google Actualités, et n’importe quelle route RSSHub pour les sites très protégés.
- **Filtres.** Garder ou exclure selon le titre, le contenu, le lien ou l’auteur, avec ou sans expression régulière. Accents et casse ignorés.
- **Texte complet.** Glaneur ouvre chaque nouvel article et en garde le contenu principal (Readability) ou la zone de votre choix.
- **Sorties.** RSS 2.0, Atom et JSON Feed, export OPML. Les articles sont conservés : quand un site n’affiche pas de date, c’est la date de première détection qui sert.
- **Suivi.** Actualisation planifiée (avec espacement progressif en cas d’erreurs répétées), journal des lectures et historique visuel de chaque flux.

## Installer sur Proxmox

### Option 1 — créer le conteneur depuis l’hôte (recommandé)

Sur votre poste, dans le dossier du projet, préparez une archive sans les dépendances :

```bash
npm run pack
```

Copiez-la sur l’hôte Proxmox :

```bash
scp release/glaneur.tar.gz root@IP-DE-PROXMOX:/root/
```

Puis, dans le shell de l’hôte Proxmox :

```bash
mkdir -p /root/glaneur && tar -xzf /root/glaneur.tar.gz -C /root/glaneur && bash /root/glaneur/deploy/proxmox/create-lxc.sh
```

Le script télécharge le modèle Debian, crée un conteneur non privilégié (2 cœurs, 1 Go de mémoire, 6 Go de disque, démarrage automatique), y copie Glaneur, l’installe comme service systemd et affiche l’adresse à ouvrir.

Les réglages se passent en variables d’environnement devant la commande :

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `CTID` | prochain libre | Numéro du conteneur |
| `CT_HOSTNAME` | `glaneur` | Nom d’hôte |
| `IP` / `GATEWAY` | `dhcp` / — | Adresse fixe, par exemple `IP=192.168.1.50/24 GATEWAY=192.168.1.1` |
| `STORAGE` | `local-lvm` | Stockage du disque du conteneur |
| `TEMPLATE_STORAGE` | `local` | Stockage des modèles |
| `BRIDGE` | `vmbr0` | Pont réseau |
| `CORES` / `MEMORY` / `DISK_GB` | `2` / `1024` / `6` | Ressources |
| `WITH_CHROMIUM` | `no` | `yes` installe Chromium pour le rendu JavaScript (mémoire portée à 2 Go) |
| `PORT` | `8080` | Port de Glaneur |

Exemple avec une adresse fixe et le rendu JavaScript :

```bash
IP=192.168.1.50/24 GATEWAY=192.168.1.1 WITH_CHROMIUM=yes bash /root/glaneur/deploy/proxmox/create-lxc.sh
```

### Option 2 — dans un conteneur existant

Dans un conteneur Debian 12/13 ou Ubuntu 22.04/24.04, copiez l’archive produite par `npm run pack` (elle garantit des fins de ligne Unix pour les scripts), décompressez-la puis, en root, depuis le dossier obtenu :

```bash
bash deploy/install.sh
```

Le script installe Node.js 24 si besoin, propose Chromium, crée l’utilisateur système `glaneur`, installe l’application dans `/opt/glaneur`, les données dans `/var/lib/glaneur`, la configuration dans `/etc/glaneur/glaneur.env`, et active le service `glaneur`.

### Option 3 — Docker

```bash
docker compose up -d --build
```

Pour le rendu JavaScript, passez `WITH_CHROMIUM: "true"` dans `docker-compose.yml`. Les données sont dans le volume `glaneur-data`.

### Ressources conseillées

Sans Chromium : 1 cœur, 512 Mo à 1 Go de mémoire, 2 Go de disque suffisent. Avec Chromium : 2 cœurs et 2 Go de mémoire. La compilation lors de l’installation demande environ 1 Go de mémoire.

## Premier accès

Ouvrez `http://ADRESSE-DU-CONTENEUR:8080`. Glaneur vous demande de choisir votre mot de passe. Les adresses des flux contiennent une **clé d’accès** : les lecteurs RSS ne savent pas se connecter, la clé les autorise à lire vos flux. Vous pouvez la régénérer ou la désactiver dans les réglages.

## Configuration

Le fichier `/etc/glaneur/glaneur.env` est lu au démarrage (`systemctl restart glaneur` après modification).

| Variable | Rôle |
| --- | --- |
| `PORT`, `HOST` | Port et adresse d’écoute (`8080`, `0.0.0.0`) |
| `DATA_DIR` | Dossier de la base SQLite (`/var/lib/glaneur`) |
| `TZ` | Fuseau utilisé pour les dates affichées sans fuseau sur les sites (`Europe/Paris`) |
| `GLANEUR_PASSWORD` | Impose le mot de passe au démarrage |
| `GLANEUR_AUTH=none` | Désactive l’authentification (uniquement derrière un proxy qui authentifie déjà) |
| `PUBLIC_URL` | Adresse publique utilisée dans les liens des flux |
| `TRUST_PROXY=true` | Fait confiance aux en-têtes `X-Forwarded-*` d’un proxy inverse |
| `CHROMIUM_PATH` | Chemin de Chromium, sinon détecté automatiquement |
| `MAX_CONCURRENCY`, `BROWSER_CONCURRENCY` | Flux actualisés en parallèle (3) et rendus Chromium simultanés (1) |

L’interface permet aussi de régler la fréquence par défaut, le User-Agent, les langues acceptées et l’instance RSSHub.

## Derrière un proxy inverse

Exemple avec Caddy :

```
glaneur.maison.lan {
  reverse_proxy 192.168.1.50:8080
}
```

Ajoutez alors `TRUST_PROXY=true` et `PUBLIC_URL=https://glaneur.maison.lan` dans `/etc/glaneur/glaneur.env`.

## Mettre à jour et sauvegarder

- **Mise à jour :** copiez la nouvelle version dans le conteneur puis lancez `bash deploy/update.sh`. Les données et la configuration sont conservées.
- **Sauvegarde :** la sauvegarde Proxmox du conteneur suffit. Vous pouvez aussi copier `/var/lib/glaneur/glaneur.db`, ou utiliser **Réglages → Exporter la configuration** (fichier JSON réimportable).
- **Journal :** `journalctl -u glaneur -f`.

## Bien glaner

- Commencez par l’analyse : la « meilleure piste » est souvent juste, il ne reste qu’à vérifier l’aperçu.
- Dans l’éditeur, désignez d’abord l’**Élément** (le bloc qui se répète), puis les champs. Les flèches à côté du sélecteur élargissent ou resserrent le bloc ; les autres champs sont recalculés.
- **Bandeaux de cookies :** avec le rendu JavaScript, Glaneur y répond lui-même grâce aux règles [autoconsent](https://github.com/duckduckgo/autoconsent) de DuckDuckGo. Il refuse quand le site le permet, et accepte sinon (quand refuser mène à une page d’abonnement, par exemple). Chaque lecture se fait dans une session jetée ensuite. Sans rendu, les bandeaux connus sont simplement masqués dans la sélection visuelle.
- **Un bouton à franchir, une fenêtre qui gêne :** dans la sélection visuelle, **Cliquer** actionne un bouton de la page dans le navigateur de Glaneur (Chromium requis) et garde les cookies obtenus dans les réglages du flux ; ils servent ensuite à chaque lecture, même sans rendu JavaScript. **Masquer** cache ce qui gêne dans l’aperçu, sans rien changer au flux.
- Les compteurs à droite de chaque champ indiquent sur combien d’éléments il a été trouvé : orange si partiel, rouge si absent.
- Préférez des sélecteurs basés sur des classes explicites (`article.post`) plutôt que sur la position (`div:nth-of-type(3)`).
- Si la page apparaît vide ou incomplète, activez **JavaScript** dans la barre de l’éditeur.
- Sites protégés (Cloudflare, connexion obligatoire, Instagram, X…) : Glaneur ne contourne pas les protections. Utilisez les cookies d’une session dans **Réglages du flux → Requête**, ou passez par une instance RSSHub avec la recette dédiée.
- Pour les pages sans liste (une fiche produit, une page de statut), utilisez **Surveiller les changements**.

## Développement

Prérequis : Node.js 22.13 ou plus récent (SQLite intégré à Node, aucune compilation native).

```bash
npm install
```

```bash
npm run dev
```

Le serveur tourne sur le port 8080 et l’interface Vite sur http://localhost:5173 (avec rechargement à chaud). Autres commandes : `npm test`, `npm run typecheck`, `npm run build` puis `npm start`.

Organisation du code :

- `src/server` — API Fastify, planificateur, extraction (HTML, JSON, flux, surveillance), rendu Chromium, génération RSS/Atom/JSON Feed.
- `src/web` — interface React ; `src/web/picker` contient le moteur de sélection visuelle.
- `src/shared` — types, génération de sélecteurs et détection des listes, communs au serveur et au navigateur.
- `deploy` — installation LXC, service systemd, script de création du conteneur Proxmox.
