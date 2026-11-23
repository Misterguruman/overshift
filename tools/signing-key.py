#!/usr/bin/env python3
"""Rebuild Overshift's APK signing key from one secret password.

Android only installs an update over an app signed with the same certificate. CI needs that one
key on every build, but the key itself is never stored anywhere: this script derives the same RSA
key and the same self-signed certificate from the OVERSHIFT_SIGNING_PASSWORD repository secret,
every time, and writes them to a throwaway PKCS12 keystore for Gradle.

  python3 tools/signing-key.py OUT.p12
    reads  OVERSHIFT_SIGNING_PASSWORD  (the repository secret; long and random; never change it)
           OVERSHIFT_KEYSTORE_PASSWORD (any password for the throwaway keystore file)
    writes OUT.p12 with the key under the alias "overshift", and prints the certificate's
           SHA-256 fingerprint (public; the same on every build).

How the key is made, so it can be rebuilt by anyone holding the password:
  seed  = scrypt(password, salt "overshift-apk-signing-v1", N=2^15, r=8, p=1, 32 bytes)
  bytes = SHAKE-256(seed || 8-byte big-endian counter), counter += 1 per draw
  p, q  = first probable primes (40 Miller-Rabin rounds, bases drawn the same way) at or above a
          1536-bit draw with its top two bits and low bit set, with gcd(prime - 1, 65537) = 1
  cert  = CN=Overshift, serial 1, valid 2026-01-01 to 2076-01-01, SHA-256 RSA PKCS#1 v1.5
          (PKCS#1 v1.5 signing is deterministic, so the certificate bytes repeat exactly)

Changing anything above, or the password, makes a different key: installed copies would then
need to be uninstalled once. Bump the salt's version only on purpose.
"""
import datetime
import hashlib
import math
import os
import sys

from cryptography import x509
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import PrivateFormat, pkcs12
from cryptography.x509.oid import NameOID

SALT = b"overshift-apk-signing-v1"
E = 65537
PRIME_BITS = 1536
SMALL_PRIMES = [p for p in range(3, 2000) if all(p % d for d in range(2, int(p ** 0.5) + 1))]


class Stream:
    """Deterministic byte stream: SHAKE-256 over the seed and a counter."""

    def __init__(self, seed):
        self.seed = seed
        self.counter = 0

    def take(self, n):
        out = hashlib.shake_256(self.seed + self.counter.to_bytes(8, "big")).digest(n)
        self.counter += 1
        return out

    def below(self, limit):
        """A number in [2, limit - 2] for Miller-Rabin bases."""
        size = (limit.bit_length() + 7) // 8 + 8
        return 2 + int.from_bytes(self.take(size), "big") % (limit - 3)


def probably_prime(n, stream, rounds=40):
    for p in SMALL_PRIMES:
        if n % p == 0:
            return n == p
    d, s = n - 1, 0
    while d % 2 == 0:
        d //= 2
        s += 1
    for _ in range(rounds):
        x = pow(stream.below(n), d, n)
        if x in (1, n - 1):
            continue
        for _ in range(s - 1):
            x = pow(x, 2, n)
            if x == n - 1:
                break
        else:
            return False
    return True


def next_prime(stream):
    n = int.from_bytes(stream.take(PRIME_BITS // 8), "big")
    n |= (3 << (PRIME_BITS - 2)) | 1
    while True:
        if math.gcd(n - 1, E) == 1 and probably_prime(n, stream):
            return n
        n += 2


def derive_key(password):
    seed = hashlib.scrypt(password.encode("utf-8"), salt=SALT, n=2 ** 15, r=8, p=1,
                          maxmem=64 * 1024 * 1024, dklen=32)
    stream = Stream(seed)
    p = next_prime(stream)
    q = next_prime(stream)
    while q == p:
        q = next_prime(stream)
    if p < q:
        p, q = q, p
    d = pow(E, -1, math.lcm(p - 1, q - 1))
    numbers = rsa.RSAPrivateNumbers(
        p=p, q=q, d=d,
        dmp1=rsa.rsa_crt_dmp1(d, p), dmq1=rsa.rsa_crt_dmq1(d, q), iqmp=rsa.rsa_crt_iqmp(p, q),
        public_numbers=rsa.RSAPublicNumbers(E, p * q),
    )
    return numbers.private_key()


def certificate(key):
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Overshift")])
    utc = datetime.timezone.utc
    return (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(1)
        .not_valid_before(datetime.datetime(2026, 1, 1, tzinfo=utc))
        .not_valid_after(datetime.datetime(2076, 1, 1, tzinfo=utc))
        .sign(key, hashes.SHA256())
    )


def main():
    if len(sys.argv) != 2:
        sys.exit("usage: signing-key.py OUT.p12")
    password = os.environ.get("OVERSHIFT_SIGNING_PASSWORD", "")
    store_password = os.environ.get("OVERSHIFT_KEYSTORE_PASSWORD", "")
    if len(password) < 16:
        sys.exit("OVERSHIFT_SIGNING_PASSWORD must be set and at least 16 characters long")
    if not store_password:
        sys.exit("OVERSHIFT_KEYSTORE_PASSWORD must be set")
    key = derive_key(password)
    cert = certificate(key)
    encryption = (
        PrivateFormat.PKCS12.encryption_builder()
        .kdf_rounds(50000)
        .key_cert_algorithm(pkcs12.PBES.PBESv2SHA256AndAES256CBC)
        .hmac_hash(hashes.SHA256())
        .build(store_password.encode("utf-8"))
    )
    with open(sys.argv[1], "wb") as f:
        f.write(pkcs12.serialize_key_and_certificates(b"overshift", key, cert, None, encryption))
    print("Signing certificate SHA-256:", cert.fingerprint(hashes.SHA256()).hex(":").upper())


if __name__ == "__main__":
    main()
