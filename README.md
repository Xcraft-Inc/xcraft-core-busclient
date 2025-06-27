# 📘 xcraft-core-busclient

## Aperçu

Le module `xcraft-core-busclient` est le client principal pour le bus de communication Xcraft. Il fournit les interfaces nécessaires pour se connecter à un serveur Xcraft, envoyer des commandes et gérer les événements (publication et souscription). Ce module constitue la couche de communication fondamentale entre les différents composants de l'écosystème Xcraft.

## Sommaire

- [Structure du module](#structure-du-module)
- [Fonctionnement global](#fonctionnement-global)
- [Exemples d'utilisation](#exemples-dutilisation)
- [Interactions avec d'autres modules](#interactions-avec-dautres-modules)
- [Configuration avancée](#configuration-avancée)
- [Détails des sources](#détails-des-sources)

## Structure du module

Le module s'articule autour de plusieurs composants principaux :

- **BusClient** : Classe principale gérant la connexion au bus Xcraft
- **Command** : Gestionnaire pour l'envoi de commandes
- **Events** : Gestionnaire pour la publication et souscription d'événements
- **Resp** : Interface de réponse unifiée combinant commandes et événements
- **Instance globale** : Client partagé entre tous les modules

## Fonctionnement global

### Architecture de communication

Le `BusClient` utilise deux sockets distincts basés sur le module [xcraft-core-transport] :

- **Socket SUB** : Pour recevoir les événements et notifications
- **Socket PUSH** : Pour envoyer les commandes

### Mécanisme d'autoconnexion

Le client peut fonctionner en deux modes :

1. **Mode serveur** : Connexion directe avec un token fourni
2. **Mode client** : Autoconnexion automatique via le mécanisme de heartbeat

Le processus d'autoconnexion :

1. Le client s'abonne aux événements `greathall::*`
2. Il attend le heartbeat du serveur (`greathall::heartbeat`)
3. Il envoie une commande `autoconnect` avec un token temporaire
4. Le serveur répond avec le token définitif et les informations de configuration

### Gestion des reconnexions

Le système détecte automatiquement les déconnexions et tente de se reconnecter :

- Détection des pertes de connexion sur les deux sockets
- Mécanisme de reconnexion automatique avec gestion des timeouts
- Émission d'événements pour notifier les changements d'état
- Protection spéciale pour les nœuds internes (localhost) qui provoquent un arrêt complet en cas de perte

### Sécurité et authentification

Le module supporte plusieurs mécanismes de sécurité :

- **TLS** : Chiffrement des communications avec certificats
- **Tokens** : Authentification par tokens dynamiques
- **Certificats clients** : Authentification mutuelle pour les hordes
- **Gatekeeper** : Système de contrôle d'accès avancé

## Exemples d'utilisation

### Utilisation du client global

```javascript
const xBusClient = require('xcraft-core-busclient');

// Initialisation du client global
const globalClient = xBusClient.initGlobal();

// Connexion au serveur
globalClient.connect('ee', null, (err) => {
  if (err) {
    console.error('Erreur de connexion:', err);
    return;
  }
  console.log('Connecté au bus Xcraft');
});
```

### Envoi de commandes

```javascript
const resp = xBusClient.newResponse('mon-module', 'greathall');

// Envoi d'une commande avec callback
resp.command.send('warehouse.get', {path: 'app.name'}, (err, result) => {
  if (err) {
    console.error('Erreur:', err);
    return;
  }
  console.log('Résultat:', result.data);
});

// Envoi asynchrone
const result = await resp.command.sendAsync('warehouse.get', {
  path: 'app.name',
});
console.log('Résultat:', result);
```

### Gestion des événements

```javascript
// Souscription à un événement
const unsubscribe = resp.events.subscribe('warehouse::changed', (msg) => {
  console.log('Warehouse modifié:', msg.data);
});

// Publication d'un événement (côté serveur uniquement)
resp.events.send('mon-module::status.changed', {status: 'ready'});

// Désabonnement
unsubscribe();
```

### Instance personnalisée avec TLS

```javascript
const {BusClient} = require('xcraft-core-busclient');

// Configuration personnalisée avec TLS
const customConfig = {
  host: 'remote-server.com',
  commanderPort: 3001,
  notifierPort: 3002,
  caPath: '/path/to/server-cert.pem',
  keyPath: '/path/to/client-key.pem',
  certPath: '/path/to/client-cert.pem',
};

const customClient = new BusClient(customConfig);
customClient.connect('axon', null, (err) => {
  // Gestion de la connexion
});
```

### Gestion des reconnexions

```javascript
const resp = xBusClient.newResponse('mon-module', 'greathall');

// Écoute des événements de reconnexion
const unsubReconnect = resp.onReconnect((status) => {
  if (status === 'attempt') {
    console.log('Tentative de reconnexion...');
  } else if (status === 'done') {
    console.log('Reconnexion réussie');
  }
});

// Écoute des changements de token
const unsubToken = resp.onTokenChanged((busConfig) => {
  console.log('Token changé, nouvelle configuration:', busConfig);
});
```

## Interactions avec d'autres modules

### Modules de transport

- **[xcraft-core-transport]** : Fournit les sockets Router pour la communication
- **[xcraft-core-bus]** : Interface serveur complémentaire

### Modules de configuration

- **[xcraft-core-etc]** : Gestion de la configuration du bus
- **[xcraft-core-host]** : Informations sur l'environnement d'exécution

### Modules utilitaires

- **[xcraft-core-log]** : Système de logging
- **[xcraft-core-utils]** : Utilitaires pour la cryptographie et les expressions régulières
- **fs-extra** : Opérations sur le système de fichiers
- **uuid** : Génération d'identifiants uniques

## Configuration avancée

| Option   | Description                                    | Type     | Valeur par défaut |
| -------- | ---------------------------------------------- | -------- | ----------------- |
| `caPath` | Chemin vers le certificat serveur (format PEM) | `string` | `''`              |

### Variables d'environnement

Le module utilise les variables d'environnement via la configuration du bus (`xcraft-core-bus`) :

| Variable     | Description          | Exemple | Valeur par défaut |
| ------------ | -------------------- | ------- | ----------------- |
| `XCRAFT_TLS` | Active/désactive TLS | `false` | `true`            |

## Détails des sources

### `index.js`

Fichier principal exportant la classe `BusClient` et les fonctions utilitaires. La classe `BusClient` hérite d'`EventEmitter` et gère :

- **Connexion** : Établissement et maintien de la connexion au serveur
- **Autoconnexion** : Mécanisme automatique de connexion via heartbeat
- **Registre des commandes** : Cache des commandes disponibles sur le serveur
- **Gestion des tokens** : Authentification et autorisation
- **Reconnexion** : Détection et récupération des déconnexions
- **Sécurité TLS** : Gestion des certificats et chiffrement
- **Gestion des certificats clients** : Support pour l'authentification mutuelle

#### Méthodes publiques

- **`connect(backend, busToken, callback)`** — Établit la connexion au serveur avec le backend spécifié (ee ou axon)
- **`stop(callback)`** — Ferme proprement les connexions au bus
- **`newMessage(topic, which)`** — Crée un nouveau message formaté pour les commandes
- **`patchMessage(msg)`** — Modifie un message pour le retransmettre à un autre serveur
- **`registerEvents(topic, handler)`** — Enregistre un gestionnaire d'événements avec support des expressions régulières
- **`unregisterEvents(topic)`** — Supprime un gestionnaire d'événements
- **`isConnected()`** — Retourne l'état de connexion
- **`getToken()`** — Retourne le token d'authentification actuel
- **`getOrcName()`** — Retourne le nom de l'orc (identifiant du client)
- **`getCommandsRegistry()`** — Retourne le registre des commandes disponibles
- **`getCommandsRegistryTime()`** — Retourne l'horodatage du dernier registre de commandes
- **`getCommandsNames()`** — Retourne la liste des noms de commandes avec leurs prédictions de ranking
- **`isServerSide()`** — Indique si le client fonctionne côté serveur
- **`getNice()`** — Retourne la valeur de priorité (nice) du client
- **`destroyPushSocket()`** — Détruit le socket de commandes
- **`lastErrorReason`** — Propriété getter retournant la dernière raison d'erreur

### `lib/command.js`

Gestionnaire pour l'envoi de commandes sur le bus. Cette classe encapsule la logique d'envoi de commandes avec :

- **Gestion des callbacks** : Souscription automatique aux événements de fin de commande
- **Support RPC** : Mécanisme d'appel de procédure distante avec gestion des timeouts
- **Routage** : Gestion du routage des messages entre différents nœuds
- **Gestion d'erreurs** : Traitement des erreurs et exceptions avec stack traces
- **Annulation de commandes** : Mécanisme d'annulation pour les commandes RPC
- **Gestion des déconnexions** : Annulation automatique des commandes en cours lors de déconnexions

#### Méthodes publiques

- **`send(cmd, data, which, finishHandler, options, msgContext)`** — Envoie une commande sur le bus avec gestion optionnelle des callbacks
- **`retry(msg)`** — Retente l'envoi d'un message précédemment échoué
- **`newMessage(cmd, which)`** — Crée un nouveau message de commande
- **`connectedWith()`** — Retourne les informations de connexion du socket

#### Méthodes statiques

- **`abort(commandId)`** — Annule une commande RPC spécifique
- **`abortAll(err)`** — Annule toutes les commandes RPC en cours

### `lib/events.js`

Gestionnaire pour la publication et souscription d'événements. Cette classe fournit :

- **Souscription multiple** : Support de plusieurs handlers par topic avec gestion fine des désabonnements
- **Sérialisation** : Sérialisation/désérialisation automatique des objets complexes incluant les fonctions
- **Filtrage** : Support des expressions régulières pour les topics
- **Performance** : Optimisations pour réduire le bruit des logs
- **Gestion des activités** : Support pour les événements d'activité

#### Méthodes publiques

- **`subscribe(topic, handler, backend, orcName, options)`** — S'abonne à un événement avec un gestionnaire spécifique
- **`unsubscribeAll(topic, backend, orcName)`** — Se désabonne complètement d'un topic
- **`send(topic, data, serialize, routing, msgContext)`** — Publie un événement (côté serveur uniquement)
- **`catchAll(handler, proxy)`** — Capture tous les événements avec un gestionnaire global
- **`heartbeat()`** — Envoie un heartbeat (côté serveur uniquement)
- **`lastPerf()`** — Retourne les dernières métriques de performance
- **`connectedWith()`** — Retourne les informations de connexion du socket

#### Propriétés

- **`status`** — Énumération des statuts d'événements (succeeded: 1, failed: 2, canceled: 3)

### `lib/resp.js`

Interface unifiée combinant les fonctionnalités de commandes et d'événements. Cette classe encapsule :

- **Interface simplifiée** : API unifiée pour commandes et événements
- **Gestion du contexte** : Propagation automatique du contexte des messages
- **Logging intégré** : Système de logs contextualisé par module
- **Callbacks de lifecycle** : Notifications des changements d'état de connexion
- **Support des tokens spéciaux** : Gestion du token 'token' pour les communications serveur

#### Classes internes

**Events** (dans resp.js) :

- **`subscribe(topic, handler)`** — Souscription simplifiée avec préfixage automatique du namespace
- **`send(topic, data, serialize, forwarding, context)`** — Publication avec support du forwarding
- **`catchAll(handler)`** — Capture globale des événements
- **`unsubscribeAll(topic)`** — Désabonnement simplifié

**Command** (dans resp.js) :

- **`sendAsync(cmd, data)`** — Version asynchrone moderne de l'envoi de commandes
- **`send(cmd, data, finishHandler)`** — Version legacy avec callback (dépréciée)
- **`nestedSend(cmd, data, finishHandler)`** — Version legacy pour commandes imbriquées (dépréciée)
- **`retry(msg)`** — Nouvelle tentative d'envoi

#### Méthodes publiques de Resp

- **`onTokenChanged(callback)`** — Écoute les changements de token d'authentification
- **`onOrcnameChanged(callback)`** — Écoute les changements de nom d'orc
- **`onReconnect(callback)`** — Écoute les tentatives et succès de reconnexion
- **`onCommandsRegistry(callback, data)`** — Écoute les mises à jour du registre de commandes
- **`hasCommand(cmdName)`** — Vérifie la disponibilité d'une commande
- **`getCommandsRegistry()`** — Retourne le registre des commandes disponibles
- **`getCommandsRegistryTime()`** — Retourne l'horodatage du registre
- **`getCommandsNames()`** — Retourne les noms de commandes avec métadonnées
- **`isConnected()`** — Retourne l'état de connexion

#### Propriétés

- **`orcName`** — Nom de l'orc associé à cette instance de Resp
- **`log`** — Logger contextualisé pour le module
- **`msgContext`** — Contexte de message (setter)

---

_Ce document a été mis à jour pour refléter la structure et les fonctionnalités actuelles du module._

[xcraft-core-transport]: https://github.com/Xcraft-Inc/xcraft-core-transport
[xcraft-core-bus]: https://github.com/Xcraft-Inc/xcraft-core-bus
[xcraft-core-etc]: https://github.com/Xcraft-Inc/xcraft-core-etc
[xcraft-core-host]: https://github.com/Xcraft-Inc/xcraft-core-host
[xcraft-core-log]: https://github.com/Xcraft-Inc/xcraft-core-log
[xcraft-core-utils]: https://github.com/Xcraft-Inc/xcraft-core-utils