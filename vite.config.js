import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';

export default defineConfig({
  plugins: [
    {
      name: 'dictionary-manager',
      configureServer(server) {
        server.middlewares.use('/api/remove-word', (req, res) => {
          if (req.method === 'POST') {
            let body = '';
            req.on('data', chunk => {
              body += chunk.toString();
            });
            req.on('end', () => {
              try {
                const { word, lang } = JSON.parse(body);
                if (!word) {
                    res.statusCode = 400;
                    return res.end(JSON.stringify({ error: "No word provided" }));
                }

                const dictName = lang === 'en' ? 'dictionary_en.txt' : 'dictionary_de.txt';
                const dictPath = path.resolve(process.cwd(), `public/${dictName}`);
                if (fs.existsSync(dictPath)) {
                  let dict = fs.readFileSync(dictPath, 'utf-8');
                  const words = dict.split(/\r?\n/);
                  // Filter out the word (case insensitive based on standard formatting)
                  const filtered = words.filter(w => w.trim().toLowerCase() !== word.toLowerCase());
                  
                  // Only write if changed to save I/O
                  if (words.length !== filtered.length) {
                      fs.writeFileSync(dictPath, filtered.join('\n'), 'utf-8');
                      console.log(`[Plugin] Permanently removed "${word}" from ${dictName}`);
                  } else {
                      console.log(`[Plugin] Word "${word}" was not found in ${dictName} to remove.`);
                  }
                } else {
                    console.error(`[Plugin] ${dictName} not found at`, dictPath);
                }
                
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ success: true, word }));
              } catch (e) {
                console.error(e);
                res.statusCode = 500;
                res.end(JSON.stringify({ error: e.message }));
              }
            });
          } else {
            res.statusCode = 405;
            res.end();
          }
        });
      }
    }
  ]
});
