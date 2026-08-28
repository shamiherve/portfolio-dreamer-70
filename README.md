# Equilibrium

Crée une application web de rééquilibrage de portefeuille.
L'utilisateur peut ajouter et supprimer des catégories de placement. Pour chaque catégorie, il renseigne sa valeur actuelle et son poids cible.
L'application calcule automatiquement les poids actuels et vérifie que les poids cibles totalisent 100 %.
L'utilisateur peut ensuite saisir un budget d'injection. L'application calcule la répartition optimale de cette injection entre les catégories, sans aucune vente, afin de minimiser l'écart entre les poids finaux et les poids cibles.
Elle doit également calculer l'injection minimale permettant d'atteindre exactement les poids cibles.
Afficher avant/après, les écarts en points de pourcentage, les montants injectés et la valeur finale du portefeuille.
Interface moderne, simple, responsive, en français.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://portfolio-dreamer-70.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/b07e852f-1546-47bc-8d51-4594d5fd326f).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
