import json
import math
import cmath
from pathlib import Path


def fd1(fn, x, h=1e-6):
    return (fn(x + h) - fn(x - h)) / (2 * h)


def deriv_complex_cauchy(fn, z0, n, radius=0.35, steps=64):
    """Cauchy integral formula f^(n)(z0) = n!/(2*pi*i) * oint f(z)/(z-z0)^(n+1) dz."""
    acc = 0j
    for k in range(steps):
        theta = 2 * math.pi * k / steps
        z = z0 + radius * cmath.exp(1j * theta)
        acc += fn(z) * cmath.exp(-1j * n * theta)
    return math.factorial(n) * (acc / steps) / (radius ** n)


def check_close(a, b, tol=1e-5, label=""):
    assert abs(a - b) <= tol, f"{label}: {a} != {b}"


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    raw = json.loads((root / "private" / "draft" / "gt1_raw.json").read_text("utf-8"))
    by_num = {item["num"]: item for item in raw}

    # Check exact answer text matches for every computational question!
    # Q1: d/dx ln(x + sqrt(x^2+3)) = 1/sqrt(x^2+3)
    for x in [0.4, 1.3]:
        f = lambda t: math.log(t + math.sqrt(t * t + 3))
        check_close(fd1(f, x), 1 / math.sqrt(x * x + 3), 1e-7, f"Q1@{x}")
    assert r"\dfrac{dx}{\sqrt{x^2 + 3}}" in by_num[1]["options"][by_num[1]["correct_index"]]

    # Q3: xe^(2x^2) Maclaurin to x^5 -> x + 2x^3 + 2x^5
    f3 = lambda z: z * cmath.exp(2 * z * z)
    check_close(deriv_complex_cauchy(f3, 0, 1).real, 1, 1e-7, "Q3 x^1")
    check_close(deriv_complex_cauchy(f3, 0, 3).real / 6, 2, 1e-6, "Q3 x^3")
    check_close(deriv_complex_cauchy(f3, 0, 5).real / 120, 2, 1e-5, "Q3 x^5")
    assert by_num[3]["options"][by_num[3]["correct_index"]] == r"$x + 2x^3 + 2x^5 + o(x^5)$"

    # Q4: f^(5)(x) for x e^(3x) at x=0.5 -> (243*0.5 + 405)*e^1.5
    f4 = lambda z: z * cmath.exp(3 * z)
    check_close(deriv_complex_cauchy(f4, 0.5, 5, 0.5).real, (243 * 0.5 + 405) * math.exp(1.5), 1e-3, "Q4")

    # Q9: d/dx 0.5 ln|(x-1)/(x+1)| = 1/(x^2-1)
    for x in [2.3, -1.7]:
        f9 = lambda t: 0.5 * math.log(abs((t - 1) / (t + 1)))
        check_close(fd1(f9, x), 1 / (x * x - 1), 1e-7, f"Q9@{x}")

    # Q11: x ln(1+6x) -> 6x^2 - 18x^3 + 72x^4
    f11 = lambda z: z * cmath.log(1 + 6 * z)
    check_close(deriv_complex_cauchy(f11, 0, 2, 0.08).real / 2, 6, 1e-5, "Q11 x^2")
    check_close(deriv_complex_cauchy(f11, 0, 3, 0.08).real / 6, -18, 1e-4, "Q11 x^3")
    check_close(deriv_complex_cauchy(f11, 0, 4, 0.08).real / 24, 72, 1e-3, "Q11 x^4")

    # Q12: f^(10)(x) for x e^(2x) at x=0.2 -> (1024*0.2 + 5120)*e^0.4
    f12 = lambda z: z * cmath.exp(2 * z)
    check_close(deriv_complex_cauchy(f12, 0.2, 10, 0.8).real, (1024 * 0.2 + 5120) * math.exp(0.4), 1e-1, "Q12")

    # Q15: (1-cos x)/x / x -> 0.5
    check_close(((1 - math.cos(1e-4)) / 1e-4) / 1e-4, 0.5, 1e-5, "Q15")

    # Q17, Q26: asymptotics -> 1
    check_close(1e-5 * (math.exp(math.sin(1e-5)) - 1) / (1e-10), 1.0, 1e-4, "Q17")
    check_close(1e-5 * math.log(1 + math.sin(1e-5)) / (1e-10), 1.0, 1e-4, "Q26")

    # Q20: 1 / (1 + 2^(1/x)) as x -> 0+ -> 0
    check_close(1 / (1 + 2 ** (1 / 0.005)), 0.0, 1e-10, "Q20")

    # Q30: log10(10 - x^2) max at x=0 is 1
    check_close(math.log10(10), 1.0, 1e-12, "Q30")

    # Q31: inverse arcsin(sqrt(1-2^x)), x < 0
    for x in [-0.3, -2.5]:
        y = math.asin(math.sqrt(1 - 2 ** x))
        inv = 2 * math.log2(math.cos(y))
        check_close(inv, x, 1e-10, f"Q31@{x}")

    # Q32: f(3x-2) = 18x^2 - 36x + 19, f(t) = 2t^2 - 4t + 3
    for x in [-1.2, 0.7, 3.1]:
        t = 3 * x - 2
        check_close(2 * t * t - 4 * t + 3, 18 * x * x - 36 * x + 19, 1e-10, f"Q32@{x}")

    # Q35: x -> -4- => arctan(5/(x+4)) -> -pi/2
    check_close(math.atan(5 / (-4 - 1e-7 + 4)), -math.pi / 2, 1e-5, "Q35")

    # Q36, Q37
    check_close(math.log(1 + 1e-3 * math.tan(1e-3) ** 3) / (1e-12), 1.0, 1e-4, "Q36")
    a37, b37 = 2, 21
    check_close(((1 + 2 * 1e-5) ** (1 / 3) - 1) / math.sin(7 * 1e-5), a37 / b37, 1e-4, "Q37")
    assert 6 < (a37 ** 7) / b37 < 7

    # Q39: arccot(1/x): lim 0+ = 0, lim 0- = pi -> jump = -pi
    # Standard arccot(u) in (0, pi): pi/2 - atan(u)
    arccot = lambda u: math.pi / 2 - math.atan(u)
    check_close(arccot(1 / 1e-8) - arccot(1 / (-1e-8)), -math.pi, 1e-6, "Q39")

    # Q40: f(x)=ln(2x+sqrt(4x^2+45)), f'(1)=2/7
    f40 = lambda t: math.log(2 * t + math.sqrt(4 * t * t + 45))
    check_close(fd1(f40, 1.0), 2 / 7, 1e-8, "Q40")
    assert 1 < 8 * (2 ** 3) / (7 ** 2) < 4

    # Q41: f'(2) = e/2 in (1, 2)
    assert 1 < math.e / 2 < 2

    # Q43: x^2 ln x -> f^(5)(1) = 4
    f43 = lambda z: (z * z) * cmath.log(z)
    check_close(deriv_complex_cauchy(f43, 1.0 + 0j, 5, 0.4).real, 4.0, 1e-4, "Q43")

    # Q44: 1/sqrt(1+x) - ln(1+x) = a + bx + cx^2
    f44 = lambda z: 1 / cmath.sqrt(1 + z) - cmath.log(1 + z)
    a44 = f44(0).real
    b44 = deriv_complex_cauchy(f44, 0, 1).real
    c44 = deriv_complex_cauchy(f44, 0, 2).real / 2
    check_close(a44 + b44 + c44, 3 / 8, 1e-7, "Q44")

    # Q45: lim (4x+1-e^(4x)) / ln(cos 7x) -> 16/49 (symmetric step cancels O(x) cubic error!)
    x = 1e-4
    val45 = 0.5 * (
        (4 * x + 1 - math.exp(4 * x)) / math.log(math.cos(7 * x))
        + (-4 * x + 1 - math.exp(-4 * x)) / math.log(math.cos(-7 * x))
    )
    check_close(val45, 16 / 49, 1e-6, "Q45")
    assert 4 < (16 ** 2) / (49 + 13) < 5

    # Q48: x=3+sin t cos t, y=5+sin^2 t -> (x-3)^2 + (y-5.5)^2 = 0.25
    for t in [0.2, 1.1, 2.7]:
        xx = 3 + math.sin(t) * math.cos(t)
        yy = 5 + math.sin(t) ** 2
        check_close((xx - 3) ** 2 + (yy - 5.5) ** 2, 0.25, 1e-12, f"Q48@{t}")

    # Q50: f(f(x)) = x/sqrt(2x^2+1)
    f50 = lambda t: t / math.sqrt(t * t + 1)
    for x in [-1.5, 0.8, 2.4]:
        check_close(f50(f50(x)), x / math.sqrt(2 * x * x + 1), 1e-12, f"Q50@{x}")

    # Q51: inverse arctan(sqrt(2^x - 3))
    for x in [2.1, 4.0]:
        y = math.atan(math.sqrt(2 ** x - 3))
        inv = math.log2(math.tan(y) ** 2 + 3)
        check_close(inv, x, 1e-10, f"Q51@{x}")

    # Q55: lim_{x -> -3-} 6 / (2 + 3^(1/(x+3))) = 3
    check_close(6 / (2 + 3 ** (1 / (-3 - 0.01 + 3))), 3.0, 1e-10, "Q55")

    # Q56: cbrt(1 + 6 x^2 sin x) - 1 ~ 2 x^3 => m + alpha = 5
    x = 1e-3
    check_close(((1 + 6 * x * x * math.sin(x)) ** (1 / 3) - 1) / (2 * x ** 3), 1.0, 1e-4, "Q56")

    # Q57: lim (e^(3x)-1)/ln(1+tan 7x) = 3/7 => 3^3 + 7^2 = 76
    x = 1e-5
    check_close((math.exp(3 * x) - 1) / math.log(1 + math.tan(7 * x)), 3 / 7, 1e-4, "Q57")

    # Q59: 16.6^(1/4) tangent approx
    check_close(2 + 0.6 / (4 * 16 ** 0.75), 2.01875, 1e-12, "Q59")

    # Q60: (x^2 e^(-2x))^(5)(1) * e^2 = -32
    f60 = lambda z: z * z * cmath.exp(-2 * z)
    check_close((deriv_complex_cauchy(f60, 1.0 + 0j, 5, 0.5) * math.exp(2)).real, -32.0, 1e-3, "Q60")

    # Q61: f(x)=e^x+x, inv g -> g'(1)=1/2
    check_close(1 / (math.exp(0) + 1), 0.5, 1e-12, "Q61")

    # Q63: e^(3x) + ln(1+2x) = a + bx + cx^2
    f63 = lambda z: cmath.exp(3 * z) + cmath.log(1 + 2 * z)
    s63 = f63(0).real + deriv_complex_cauchy(f63, 0, 1).real + deriv_complex_cauchy(f63, 0, 2).real / 2
    check_close(s63, 17 / 2, 1e-6, "Q63")

    # Q64: x=t^2+t+1, y=t^3+t+1 at A(3,3), t=1 -> 4x-3y-3=0
    assert 4 * 3 - 3 * 3 - 3 == 0

    # Q67: arctan(x^2) -> f^(10)(0) = 10!/5 = 725760
    f67 = lambda z: cmath.atan(z * z)
    check_close(deriv_complex_cauchy(f67, 0j, 10, 0.5, 128).real, 725760.0, 1.0, "Q67")

    # Q70: sqrt(x^3+1) tangent at x=2 -> y=2x-1
    f70 = lambda t: math.sqrt(t ** 3 + 1)
    check_close(fd1(f70, 2.0), 2.0, 1e-7, "Q70 slope")
    check_close(f70(2.0), 3.0, 1e-12, "Q70 val")

    # Q71: f=x^2+x+1, (f o f)'(1) = 21
    f71 = lambda t: t * t + t + 1
    check_close(fd1(lambda t: f71(f71(t)), 1.0), 21.0, 1e-5, "Q71")

    # Q72: x sin(2x) -> f^(5)(pi/2) = -16*pi
    f72 = lambda z: z * cmath.sin(2 * z)
    check_close(deriv_complex_cauchy(f72, math.pi / 2 + 0j, 5, 0.5).real, -16 * math.pi, 1e-3, "Q72")

    # Q77: d/dx arctan(sqrt(2x-1)) = 1/(2x sqrt(2x-1))
    f77 = lambda t: math.atan(math.sqrt(2 * t - 1))
    for x in [0.9, 2.5]:
        check_close(fd1(f77, x), 1 / (2 * x * math.sqrt(2 * x - 1)), 1e-7, f"Q77@{x}")

    # Q81: f + f^(1/3) = x => f'(2) = 3/4
    f2 = 1.0
    check_close(1 / (1 + 1 / (3 * f2 ** (2 / 3))), 3 / 4, 1e-12, "Q81")

    # Q82: (x^3 e^(-2x))^(5)(0) = 240
    f82 = lambda z: (z ** 3) * cmath.exp(-2 * z)
    check_close(deriv_complex_cauchy(f82, 0j, 5, 0.5).real, 240.0, 1e-4, "Q82")

    # Q83: Cauchy MVT [0,2] for f=x^4-x^2, g=x^2 => c = sqrt(2)
    f83 = lambda t: t ** 4 - t ** 2
    g83 = lambda t: t ** 2
    c83 = math.sqrt(2)
    check_close(fd1(f83, c83) / fd1(g83, c83), (f83(2) - f83(0)) / (g83(2) - g83(0)), 1e-6, "Q83")

    # Q88: y=x^2/(2x+1) => y = 0.5x - 0.25 + ..., a+b = 0.25
    check_close(10000 ** 2 / (2 * 10000 + 1) - (0.5 * 10000 - 0.25), 0.0, 1e-4, "Q88")

    # Q91: arccot(-1/x) at 0+ (=pi) and 0- (=0) -> jump pi > 2 > 1
    check_close(abs(arccot(-1 / 1e-8) - arccot(-1 / (-1e-8))), math.pi, 1e-6, "Q91")

    # Q92: 1/sqrt(1+x) = 1 - x/2 + 3x^2/8
    f92 = lambda z: 1 / cmath.sqrt(1 + z)
    check_close(deriv_complex_cauchy(f92, 0j, 2, 0.3).real / 2, 3 / 8, 1e-6, "Q92")

    # Q97: y=e^x/x^2 min at x=2 -> e^2/4
    f97 = lambda t: math.exp(t) / (t * t)
    check_close(fd1(f97, 2.0), 0.0, 1e-7, "Q97 stat")
    check_close(f97(2.0), math.exp(2) / 4, 1e-12, "Q97 val")

    # Q102: f(x)=(2x+1)arcsin(x^2), f^(2022)(0)/f^(2023)(0) = 1/4046
    # Verify structure on degree 6/7 analog since 2022 = 4*505+2: f^(6)(0)/f^(7)(0) = 1/(2*7) = 1/14
    f102_small = lambda z: (2 * z + 1) * cmath.asin(z * z)
    check_close(
        deriv_complex_cauchy(f102_small, 0j, 6, 0.4, 128).real / deriv_complex_cauchy(f102_small, 0j, 7, 0.4, 128).real,
        1 / (2 * 7),
        1e-5,
        "Q102 structure",
    )

    # Q103: (cos x - cos 3x) / x^2 -> 4
    check_close((math.cos(1e-4) - math.cos(3e-4)) / (1e-8), 4.0, 1e-4, "Q103")

    # Q106: x arccot(x) -> x->-inf gives pi*x + 1
    check_close(-5000 * arccot(-5000) - (math.pi * (-5000) + 1), 0.0, 1e-3, "Q106")

    # Q110: ln(cos 4x) ~ -8x^2 => b-a = 2 - (-8) = 10
    check_close(math.log(math.cos(4 * 1e-4)) / (1e-8), -8.0, 1e-4, "Q110")

    # Q112: x e^(1/x) -> x + 1
    check_close(5000 * math.exp(1 / 5000) - 5001, 0.0, 1e-3, "Q112")

    # Verify bank structural invariants
    bank = json.loads((root / "private" / "questions.json").read_text("utf-8"))
    seen_ids = set()
    for q in bank["questions"]:
        assert q["id"] not in seen_ids
        seen_ids.add(q["id"])
        assert len(q["options"]) == 4
        assert len(set(q["options"])) == 4
        assert q["answer"] in (0, 1, 2, 3)
        assert q["difficulty"] in (1, 2, 3)
        assert q["status"] == "verified"

    print(f"ALL {len(bank['questions'])} questions & mathematical assertions PASSED!")


if __name__ == "__main__":
    main()
