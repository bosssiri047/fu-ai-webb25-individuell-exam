# PixelForge

PixelForge is a React storefront with an Express backend that powers its AI support chat. The frontend and backend are included in this repository and run as separate projects.

## Prerequisites

Install the following before getting started:

- [Git](https://git-scm.com/)
- [Node.js](https://nodejs.org/) and npm
- [Ollama](https://ollama.com/) (required for the support chat)
- A [Supabase](https://supabase.com/) project (required for support-document search)

Check that Node.js and npm are installed:

```bash
node --version
npm --version
```

## 1. Clone the repository

Clone this repository, which contains both the frontend and backend:

```bash
git clone https://github.com/bosssiri047/fu-ai-webb25-individuell-exam.git
cd fu-ai-webb25-individuell-exam
```

The project directories are:

```text
pixelforge-backend/
pixelforge-frontend/
```

## 2. Set up the backend

Open a terminal in the backend directory and install its dependencies:

```bash
cd pixelforge-backend
npm install
```

### Configure Supabase

Create a Supabase project and configure it for vector search:

1. Create a `documents` table to store document text, metadata, and embeddings.
2. Create a `match_documents` function for similarity search.
3. Make sure the vector column dimension matches the embedding model you will use.
4. Ensure the key configured below has permission to write to and search the table.

The table and function names must match those expected by the backend. See the [backend README](./pixelforge-backend/README-backend.md) for more details.

### Configure Ollama

Start Ollama and download the models you want to use. For example:

```bash
ollama pull qwen3:4b
ollama pull nomic-embed-text
```

The embedding model must match the model configured in `.env` and the vector dimension in Supabase. Use the same embedding model when loading documents and when searching them.

### Configure backend environment variables

Create a `.env` file in `pixelforge-backend` with your own Supabase details and Ollama model names:

```dotenv
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-supabase-key
OLLAMA_LLM=qwen3:4b
OLLAMA_EMBEDDING_MODEL=nomic-embed-text
```

The backend uses port `8080` by default. To change it, add `PORT=your-port` to `.env`.

Keep this file and its secrets out of Git. Never put Supabase keys or other secrets in frontend code.

### Load the support documents

With Supabase configured and Ollama running, run the seed script from `pixelforge-backend`:

```bash
npm run seed
```

The script loads the PDFs from `documents/` and stores their embeddings in Supabase. It does not remove existing rows, so running it more than once can create duplicate entries.

## 3. Set up the frontend

Open a second terminal in the repository root, then install the frontend dependencies:

```bash
cd pixelforge-frontend
npm install
```

The frontend sends chat requests to `http://localhost:8080` by default. If your backend uses a different address or port, create a `.env` file in `pixelforge-frontend`:

```dotenv
VITE_API_BASE_URL=http://localhost:8080
```

The frontend does not need Supabase credentials.

## 4. Run the application

Keep both terminals open.

In the backend terminal, from `pixelforge-backend`, start the API:

```bash
npm run dev
```

In the frontend terminal, from `pixelforge-frontend`, start Vite:

```bash
npm run dev
```

Open the local URL printed by Vite, usually `http://localhost:5173`.

For the support chat to work, Ollama must be running, the backend environment variables must be configured, and the Supabase vector table must be set up and seeded.

## Useful commands

Run commands from the relevant project directory.

**Backend** (`pixelforge-backend`):

```bash
npm run dev   # Start the backend with automatic restarts
npm start     # Start the backend normally
npm run seed  # Load support documents into Supabase
```

**Frontend** (`pixelforge-frontend`):

```bash
npm run dev      # Start the Vite development server
npm run build    # Create a production build
npm run preview  # Preview the production build
npm run lint     # Run ESLint
```

For more information about the individual projects, see the [frontend README](./pixelforge-frontend/README.md) and [backend README](./pixelforge-backend/README-backend.md).
