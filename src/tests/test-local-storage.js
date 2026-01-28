require('dotenv').config();
const StorageFactory = require('../storage/StorageFactory');
const path = require('path');

async function testLocalStorage() {
  console.log('🗂️  Testing Local Storage...\n');

  // Force local storage
  process.env.STORAGE_DRIVER = 'local';
  process.env.STORAGE_LOCAL_PATH = './test-output/storage';

  try {
    const storage = StorageFactory.getStorage();
    console.log(`✅ Storage driver: ${storage.getName()}\n`);

    // Create test buffer
    const testContent = 'This is a test PDF content';
    const buffer = Buffer.from(testContent);

    // Test storage
    console.log('📤 Storing test file...');
    const filePath = await storage.store(
      buffer,
      'tenant-123',
      'batch-456',
      'job-789'
    );

    console.log(`✅ File stored successfully!`);
    console.log(`   Path: ${filePath}\n`);

    // Test public URL retrieval
    const publicUrl = storage.getPublicUrl(filePath);
    console.log(`🔗 Public URL: ${publicUrl}\n`);

    // Verify file exists
    const fs = require('fs');
    if (fs.existsSync(publicUrl)) {
      const content = fs.readFileSync(publicUrl, 'utf-8');
      console.log(`✅ File verified! Content matches: ${content === testContent}`);
    } else {
      console.log('❌ File not found at expected location');
    }

    console.log('\n✨ Local storage test completed successfully!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  }
}

testLocalStorage();
