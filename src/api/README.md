# Certificate Verification

**Note:** The API server has been removed. Certificate verification is now available as a command-line script.

## Verification Script

Use the `verify-certificate.js` script to verify one or more certificate PDFs.

### Usage

```bash
# Verify a single PDF
npm run verify-certificate <path-to-pdf>

# Or directly with node
node src/scripts/verify-certificate.js <path-to-pdf-or-zip>
```

### Examples

```bash
# Verify a single PDF
npm run verify-certificate ./storage/qr-embedded-certificates/tenant/batch/job-with-qr.pdf

# Verify multiple PDFs from a ZIP file
npm run verify-certificate ./certificates.zip
```

### Output

The script will display:
- Total number of files processed
- Number of valid/invalid certificates
- Detailed verification results for each file including:
  - Document hash
  - Fingerprint hash
  - Merkle proof verification status
  - Blockchain transaction verification (if available)
  - Any errors or warnings

## Verification Process

The API performs the following verification steps:

1. **Extract Embedded Original PDF**: Extracts the original PDF (before QR code) that was embedded when the certificate was created
2. **Calculate Document Hash**: Calculates H(d) = SHA3-256(original PDF)
3. **Extract QR Code Data**: Reads QR code from PDF to get verification data (Ed, Ei, SI, MPI, MPU, MRI, txHash, network)
4. **Calculate Fingerprint**: Calculates DI = H(d) + Ed + Ei, then H(DI)
5. **Verify Signature**: Verifies issuer signature SI (optional, requires public key)
6. **Calculate Merkle Leaf**: Calculates L = H(SI)
7. **Verify Intermediate Proof**: Verifies MPI connects L → MRI
8. **Verify Ultimate Proof**: Verifies MPU connects MRI → MRU (if available)
9. **Blockchain Verification**: Checks blockchain transaction (optional, requires RPC)

## Configuration

Set environment variables:

```bash
# API Port (default: 3001)
API_PORT=3001

# Storage (local or s3)
STORAGE_DRIVER=local
STORAGE_PATH=./storage

# Database
DB_NAME=your_db
DB_USER=your_user
DB_PASSWORD=your_password
DB_HOST=localhost
DB_PORT=5432
```

## Notes

- **QR Code Reading**: Currently, QR code extraction from PDF images is not fully implemented. You may need to add libraries like `pdf2pic` and `jsqr` or `qrcode-reader` to extract QR codes from rendered PDF pages.
- **File Storage**: Uploaded files are stored using the configured storage driver (local filesystem or S3) for audit purposes.
- **File Size Limit**: Maximum file size is 100MB.

