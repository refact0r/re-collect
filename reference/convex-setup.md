# Svelte Quickstart

Learn how to query data from Convex in a Svelte app.

1. Create a SvelteKit app

   Create a SvelteKit app using the `npx sv create` command.

   Other sets of options will work with the library but for this quickstart guide:

   * For "Which Svelte app template," choose **"SvelteKit minimal."**
   * For a package manager, choose **"npm."**
   * For "Add type checking with TypeScript," choose **"Yes, using TypeScript syntax."**
   * For "Select additional options," you don't need to enable anything.

   <br />

   ```
   npx sv@latest create my-app
   ```

2. Install the Convex client and server library

   To get started, install the `convex` and `convex-svelte` packages.

   ```
   cd my-app && npm install convex convex-svelte
   ```

3. Customize the convex path

   SvelteKit doesn't like referencing code outside of source, so customize the convex functionsDir to be under `src/`.

   convex.json

   ```
   {
    "functions": "src/convex/"
   }
   ```

4. Set up a Convex dev deployment

   Next, run `npx convex dev`. This will prompt you to log in with GitHub, create a project, and save your production and deployment URLs.

   It will also create a `src/convex/` folder for you to write your backend API functions in. The `dev` command will then continue running to sync your functions with your dev deployment in the cloud.

   ```
   npx convex dev
   ```

5. Create sample data for your database

   In a new terminal window, create a `sampleData.jsonl` file with some sample data.

   sampleData.jsonl

   ```
   {"text": "Buy groceries", "isCompleted": true}
   {"text": "Go for a swim", "isCompleted": true}
   {"text": "Integrate Convex", "isCompleted": false}
   ```

6. Add the sample data to your database

   Now that your project is ready, add a `tasks` table with the sample data into your Convex database with the `import` command.

   ```
   npx convex import --table tasks sampleData.jsonl
   ```

7. Expose a database query

   Add a new file `tasks.ts` in the `convex/` folder with a query function that loads the data.

   Exporting a query function from this file declares an API function named after the file and the export name, `api.tasks.get`.

   src/convex/tasks.ts

   ```
   import { query } from "./_generated/server";

   export const get = query({
     args: {},
     handler: async (ctx) => {
       const tasks = await ctx.db.query("tasks").collect();
       return tasks.map((task) => ({ ...task, assigner: "tom" }));
     },
   });
   ```

8. Set up Convex

   Create a new file `src/routes/+layout.svelte` and set up the Convex client there to make it available on every page of your app.

   src/routes/+layout.svelte

   ```
   <script lang="ts">
    import { PUBLIC_CONVEX_URL } from '$env/static/public';
    import { setupConvex } from 'convex-svelte';

    const { children } = $props();
    setupConvex(PUBLIC_CONVEX_URL);
   </script>

   {@render children()}
   ```

9. Display the data in your app

   In `src/routes/+page.svelte` use `useQuery` to subscribe your `api.tasks.get` API function.

   src/routes/+page.svelte

   ```
   <script lang="ts">
    import { useQuery } from 'convex-svelte';
    import { api } from '../convex/_generated/api.js';

    const query = useQuery(api.tasks.get, {});
   </script>

   {#if query.isLoading}
    Loading...
   {:else if query.error}
    failed to load: {query.error.toString()}
   {:else}
    <ul>
     {#each query.data as task}
      <li>
       {task.isCompleted ? '☑' : '☐'}
       <span>{task.text}</span>
       <span>assigned by {task.assigner}</span>
      </li>
     {/each}
    </ul>
   {/if}
   ```

10. Start the app

    Start the app, open <http://localhost:5173> in a browser, and see the list of tasks.

    ```
    npm run dev
    ```

See the [Svelte npm package documentation](https://www.npmjs.com/package/convex-svelte).
