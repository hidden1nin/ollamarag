import lancedb from '@lancedb/lancedb';
import ollama from 'ollama';
import fs from  'fs/promises';


// Initialize LanceDB connection
async function setupDatabase() {
  //Maybe create seperate databases if multiple knowledge bases are needed?
  const db = await lancedb.connect('data/sample-lancedb');
  const embed = await ollama.embed({ model: "nomic-embed-text", input: "This is example embed." });
  const vector = embed["embeddings"][0]
  // Create the table with a vector field
  const table = await db.createTable("my_table", [
    { text: "This is embed." , vector:vector , file: "base.txt" }
  ], {
    mode: "overwrite",
  });

  return table;
}

// Function to insert data
async function insertData(table, text, file) {
  // Split text every 4000 characters and generate embeddings for each part
  const chunks = text.match(/.{1,4096}/g);
  for (const chunk of chunks) {
    // Generate embedding for this chunk of text
    const embedding = await ollama.embed({ model: "nomic-embed-text", input: chunk });
    const vector = embedding['embeddings'][0];
    // Insert this chunk of text into the table with its embedding and file name
    await table.add([{
      text,
      vector,
      file
    }
    ]);
  }
}


// Function to search for similar entries
async function searchDatabase(table, queryText) {
  const queryEmbedding = await ollama.embed({ model: "nomic-embed-text", input: queryText });
  const queryVector = queryEmbedding['embeddings'][0];


  const results = await table.vectorSearch(queryVector).limit(5).toArray()

  return results;
}



// Function to read CSV and insert data into database
async function readCSVAndInsertData(table,csvFilePath) {
  const text = await fs.readFile(csvFilePath,"utf8");
  const lines = text.split('\n');

  for (let i = 1; i < lines.length; i++) { // Start from index 1 to skip the header row
    const [url, title, index, ...textContentParts] = lines[i].split(',');
    const textContentAll = textContentParts.join(',');
    if(!title) continue;
    await insertData(table,textContentAll,title); 
  }
}

//Delete entries with specific file name
async function removeAllEntriesFromFile(table,file) {
  try {
    table.delete('file = "'+ file + '"');
  } catch (error) {
      console.error(`An error occurred while removing entries: ${error}`);
  }
}


// Example usage
(async () => {
  console.log("Setting up LanceDB...");
  const table = await setupDatabase();

  // Insert the data into the database
  console.log("Inserting data...");
  const text = "Hello! This is an Example Embed";
  const file = "example.txt";
  await insertData(table, text, file);

  console.log("Reading CSV and inserting data...");
  await readCSVAndInsertData(table,'data/sentences.csv');

  //Delete entries with specific file name
  console.log("Removing entries...");
  await removeAllEntriesFromFile(table,'Could independents in Gloucester hold the key to empty shops? - BBC News');

  // Now, let's perform a search
  const queryText = "How much money did the government borrow in march 2024?"; // Change this to your search query
  console.log(`Searching for: ${queryText}`);
  const searchResults = await searchDatabase(table, queryText);
  
  // Rerank the results based on relevance to the query text
  console.log("Reranking search results...");

  //TODO Add Re-Ranking code here


  var context = "";
  for (let i = 0; i < searchResults.length; i++) {
    const result = searchResults[i];
    console.log(`File: ${result.file}`);
    context += `\n ${result.text}`;
  }

  // Asking Llama to generate a summary of the search results
  console.log("Asking Llama to generate a summary...");
  var messages = [
    {role:'system', content:`You are a helpful AI, users can ask you questions and you will be provided information to answer them with.`},
    {role:'system', content:`Context: ${context}`},
    {role:'user', content:queryText}
  ]
  console.log(context);
  var result = await ollama.chat({model:"llama3.1:70b", messages:messages, stream: true});
  for await (const part of result) {
    process.stdout.write(part.message.content);
  }
})();
