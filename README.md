# White Majorelle Club Portal

Portail client autonome destiné à `https://club.whitemajorelle.com`.

## Configuration

La configuration Supabase du projet `dqdybcwbzsyalfworstn` a été appliquée le 11 novembre 2026 :

- schéma, index, triggers et politiques RLS installés ;
- clé **Publishable** publique installée dans `dist/config.js` ;
- connexion par e-mail et Google vérifiée comme active ;
- analyseurs Supabase de sécurité et de santé sans alerte.

Pour la mise en ligne :

1. Déployer le contenu du dossier `dist/` à la racine du sous-domaine.
2. Conserver les redirections Supabase suivantes :
   - `https://club.whitemajorelle.com`
   - `https://club.whitemajorelle.com/auth/callback`

La clé `service_role`, le secret OAuth Google et tout autre secret serveur ne doivent jamais être placés dans `dist/`.

## Domaine et hébergement

Au 11 novembre 2026, `club.whitemajorelle.com` ne possède encore aucun enregistrement DNS.

Une fois l'hébergement statique choisi :

1. Déployer tout le contenu de `dist/`, y compris `.htaccess`.
2. Créer chez Nindohost l'enregistrement `club` demandé par l'hébergeur (CNAME ou A).
3. Activer HTTPS avant le premier test de connexion Google.
4. Vérifier que `/auth/callback` retourne bien `index.html`.
5. Tester inscription e-mail, confirmation, récupération du mot de passe et Google.

## Sécurité

- Les tables Supabase utilisent RLS et `auth.uid()`.
- Les réservations et points sont en lecture seule pour les clients.
- La réclamation d'une récompense passe par la fonction SQL `claim_reward`, qui recalcule les points côté base.
- Aucun secret serveur n'est attendu dans le navigateur.
- Le portail applique CSP, `nosniff`, une politique de référent stricte et interdit l'intégration dans une iframe.

## Vérification locale

Ouvrir `/?demo=1` pour afficher un compte de démonstration sans appeler Supabase.
