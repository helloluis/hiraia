/**
 * The signer against AWS's own published examples, copied verbatim:
 * - the four S3 header-signing examples of "Signature Calculations for the Authorization Header: Transferring
 *   Payload in a Single Chunk" (Amazon S3 API Reference; archived copy of January 2022, as the live page has moved),
 *   credentials AKIAIOSFODNN7EXAMPLE / wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY (AWS's documented example key);
 * - three cases of AWS's Signature Version 4 test suite (get-vanilla, get-vanilla-query-order-key-case,
 *   post-sts-header-before), credentials AKIDEXAMPLE / wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY.
 * Both secret keys are AWS's public examples, not credentials.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { amzDate, awsEncode, canonicalPath, canonicalQuery, EMPTY_PAYLOAD_SHA256, signV4 } from './s3-sign';

const S3 = { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1', service: 's3', amzDate: '20130524T000000Z' };
const SUITE = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', region: 'us-east-1', service: 'service', amzDate: '20150830T123600Z' };
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

test('S3 example: GET Object with a Range header', () => {
  const s = signV4({
    ...S3,
    method: 'GET',
    path: '/test.txt',
    headers: { Host: 'examplebucket.s3.amazonaws.com', Range: 'bytes=0-9', 'x-amz-content-sha256': EMPTY_PAYLOAD_SHA256, 'x-amz-date': '20130524T000000Z' },
    payloadHash: EMPTY_PAYLOAD_SHA256,
  });
  assert.equal(
    s.canonicalRequest,
    'GET\n/test.txt\n\nhost:examplebucket.s3.amazonaws.com\nrange:bytes=0-9\nx-amz-content-sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\nx-amz-date:20130524T000000Z\n\nhost;range;x-amz-content-sha256;x-amz-date\ne3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  );
  assert.equal(sha(s.canonicalRequest), '7344ae5b7ee6c3e7e6b0fe0640412a37625d1fbfff95c48bbb2dc43964946972');
  assert.equal(s.stringToSign, 'AWS4-HMAC-SHA256\n20130524T000000Z\n20130524/us-east-1/s3/aws4_request\n7344ae5b7ee6c3e7e6b0fe0640412a37625d1fbfff95c48bbb2dc43964946972');
  assert.equal(s.signature, 'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
  assert.equal(s.signedHeaders, 'host;range;x-amz-content-sha256;x-amz-date');
});

test('S3 example: PUT Object (a name that has to be encoded, a payload hash, a storage-class header)', () => {
  const payload = sha('Welcome to Amazon S3.');
  assert.equal(payload, '44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072');
  const s = signV4({
    ...S3,
    method: 'PUT',
    path: '/test$file.text',
    headers: {
      Host: 'examplebucket.s3.amazonaws.com',
      Date: 'Fri, 24 May 2013 00:00:00 GMT',
      'x-amz-date': '20130524T000000Z',
      'x-amz-storage-class': 'REDUCED_REDUNDANCY',
      'x-amz-content-sha256': payload,
    },
    payloadHash: payload,
  });
  assert.ok(s.canonicalRequest.startsWith('PUT\n/test%24file.text\n\n'));
  assert.equal(sha(s.canonicalRequest), '9e0e90d9c76de8fa5b200d8c849cd5b8dc7a3be3951ddb7f6a76b4158342019d');
  assert.equal(s.signature, '98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd');
});

test('S3 examples: GET Bucket Lifecycle and GET Bucket (list), with query parameters', () => {
  const headers = { Host: 'examplebucket.s3.amazonaws.com', 'x-amz-date': '20130524T000000Z', 'x-amz-content-sha256': EMPTY_PAYLOAD_SHA256 };
  const lifecycle = signV4({ ...S3, method: 'GET', path: '/', query: [['lifecycle', '']], headers, payloadHash: EMPTY_PAYLOAD_SHA256 });
  assert.equal(sha(lifecycle.canonicalRequest), '9766c798316ff2757b517bc739a67f6213b4ab36dd5da2f94eaebf79c77395ca');
  assert.equal(lifecycle.signature, 'fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543');
  const list = signV4({ ...S3, method: 'GET', path: '/', query: [['prefix', 'J'], ['max-keys', '2']], headers, payloadHash: EMPTY_PAYLOAD_SHA256 });
  assert.ok(list.canonicalRequest.startsWith('GET\n/\nmax-keys=2&prefix=J\n'));
  assert.equal(list.signature, '34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7');
});

test('SigV4 test suite: get-vanilla, the query-order case and a session token (post-sts-header-before)', () => {
  const vanilla = signV4({ ...SUITE, method: 'GET', path: '/', headers: { Host: 'example.amazonaws.com', 'X-Amz-Date': '20150830T123600Z' }, payloadHash: EMPTY_PAYLOAD_SHA256 });
  assert.equal(sha(vanilla.canonicalRequest), 'bb579772317eb040ac9ed261061d46c1f17a8133879d6129b6e1c25292927e63');
  assert.equal(vanilla.authorization, 'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31');
  const order = signV4({
    ...SUITE,
    method: 'GET',
    path: '/',
    query: [['Param2', 'value2'], ['Param1', 'value1']],
    headers: { Host: 'example.amazonaws.com', 'X-Amz-Date': '20150830T123600Z' },
    payloadHash: EMPTY_PAYLOAD_SHA256,
  });
  assert.equal(sha(order.canonicalRequest), '816cd5b414d056048ba4f7c5386d6e0533120fb1fcfa93762cf0fc39e2cf19e0');
  assert.equal(order.signature, 'b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500');
  const token =
    'AQoDYXdzEPT//////////wEXAMPLEtc764bNrC9SAPBSM22wDOk4x4HIZ8j4FZTwdQWLWsKWHGBuFqwAeMicRXmxfpSPfIeoIYRqTflfKD8YUuwthAx7mSEI/qkPpKPi/kMcGdQrmGdeehM4IC1NtBmUpp2wUE8phUZampKsburEDy0KPkyQDYwT7WZ0wq5VSXDvp75YU9HFvlRd8Tx6q6fE8YQcHNVXAkiY9q6d+xo0rKwT38xVqr7ZD0u0iPPkUL64lIZbqBAz+scqKmlzm8FDrypNC9Yjc8fPOLn9FX9KSYvKTr4rvx3iSIlTJabIQwj2ICCR/oLxBA==';
  const sts = signV4({
    ...SUITE,
    method: 'POST',
    path: '/',
    headers: { Host: 'example.amazonaws.com', 'X-Amz-Date': '20150830T123600Z', 'X-Amz-Security-Token': token },
    payloadHash: EMPTY_PAYLOAD_SHA256,
  });
  assert.equal(sha(sts.canonicalRequest), 'c237e1b440d4c63c32ca95b5b99481081cb7b13c7e40434868e71567c1a882f6');
  assert.equal(sts.signature, '85d96828115b5dc0cfc3bd16ad9e210dd772bbebba041836c64533a82be05ead');
});

test('encoding: unreserved characters stay, everything else is %XX once; slashes in a path stay', () => {
  assert.equal(awsEncode("a-_.~!*'() /"), 'a-_.~%21%2A%27%28%29%20%2F');
  assert.equal(canonicalPath('/hiraia-archive/tala/production/teachers/u1/uploads/u2/original'), '/hiraia-archive/tala/production/teachers/u1/uploads/u2/original');
  assert.equal(canonicalPath('/b/a b/ñ'), '/b/a%20b/%C3%B1');
  assert.equal(canonicalQuery([['b', '2'], ['a', '1'], ['a', '0']]), 'a=0&a=1&b=2');
  assert.equal(amzDate(new Date('2026-11-25T10:59:30.123Z')), '20261125T105930Z');
  assert.throws(() => signV4({ ...SUITE, method: 'GET', path: '/', headers: { 'x-amz-date': SUITE.amzDate }, payloadHash: EMPTY_PAYLOAD_SHA256 }), /host/);
});
