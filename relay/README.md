# 디트릭스 중계(AWS Lambda) 설정 안내

디트릭스(dtryx.com)는 해외 IP 접속을 막습니다. GitHub 서버는 해외에 있어서 접속이 안 되므로,
**한국(서울)에 작은 중계 함수**를 하나 만들어 그 함수가 대신 접속하게 합니다.
무료 사용량 안에서 쓰이며(월 약 26만 건, 무료 한도 100만 건), 약 20분 걸립니다.

> 토큰(비밀번호 역할의 긴 문자열)은 **채팅창에 붙여넣지 마세요.** 아래 안내대로 복사/붙여넣기만 합니다.

---

## 0. 먼저: 비밀번호용 토큰 만들기 (1분)
1. 윈도우 시작 메뉴에서 **PowerShell**을 열고 아래 한 줄을 붙여넣은 뒤 Enter.
   (회색 상자 안의 `$b=` 로 시작하는 **한 줄만** 복사하세요. ```` ``` ```` 로 된 줄은 복사하면 오류가 납니다.)
   ```powershell
   $b=New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); ([BitConverter]::ToString($b) -replace '-','') | Set-Clipboard
   ```
   화면에는 아무것도 안 나옵니다. 정상이며, 토큰이 **클립보드(복사됨)** 에 들어갔습니다.
2. 메모장을 열어 **Ctrl+V** 로 붙여넣고, 이 파일을 안전한 곳에 저장해 두세요(나중에 두 군데에 붙여넣어야 합니다).
   채팅창에는 올리지 않습니다.

## 1. 지역을 서울로 바꾸기 (가장 중요!)
1. https://console.aws.amazon.com 에 로그인.
2. 화면 **오른쪽 위**, 계정 이름 옆의 지역 이름(지금 **시드니**로 보일 수 있음)을 클릭.
3. 목록에서 **아시아 태평양(서울) ap-northeast-2** (Asia Pacific (Seoul))를 선택.
4. 지역 표시가 **서울**로 바뀐 것을 확인합니다.
   > 시드니 등 해외에서 만들면 디트릭스가 또 막습니다. 반드시 서울이어야 합니다.

## 2. 함수 만들기
1. 위쪽 검색창에 **Lambda** 입력 → **Lambda** 클릭 → **함수 생성**(Create function).
2. **새로 작성**(Author from scratch)을 선택하고 입력:
   - 함수 이름: `dtryx-relay`
   - 런타임: **Python 3.12** (더 높은 Python 3.x가 있으면 그것도 가능)
   - 나머지는 그대로 → **함수 생성**.
3. 만들어지면 **코드** 탭에 `lambda_function.py` 가 보입니다.
   - 안의 내용을 **전부 지우고**, 이 폴더의 `dtryx_relay.py` 파일 내용을 **전부 복사해서 붙여넣기**.
   - **Deploy**(배포) 버튼 클릭.

## 3. 설정 3가지
**구성**(Configuration) 탭에서:
1. **일반 구성**(General configuration) → **편집**(Edit)
   - 메모리 **128** MB, 제한 시간(Timeout) **0분 15초** → **저장**.
2. **환경 변수**(Environment variables) → **편집** → **환경 변수 추가**
   - 키: `RELAY_TOKEN`
   - 값: 0단계에서 만든 **토큰을 붙여넣기** → **저장**.
3. **동시성**(Concurrency and recursion detection 또는 Concurrency) → **편집**
   - **예약된 동시성 사용**(Reserve concurrency)을 선택하고 **1** 입력 → **저장**.
   - 만약 "계정의 미예약 동시성이 너무 낮다"는 오류가 나면 이 항목은 건너뛰세요.
     (신규 계정의 한도 때문입니다. 아래 4단계의 예산 알림이 대신 안전장치가 됩니다.)

## 4. 접속 주소(Function URL) 만들기
1. **구성** 탭 → **함수 URL**(Function URL) → **함수 URL 생성**(Create function URL).
2. **인증 유형**(Auth type): **NONE** 선택 (토큰으로 보호하므로 괜찮습니다) → **저장**.
3. 생성된 **함수 URL** (`https://xxxx.lambda-url.ap-northeast-2.on.aws/` 형태)을 복사해 메모장에 적어 둡니다.
   - 주소에 `ap-northeast-2` 가 들어 있으면 서울에서 만든 것이 맞습니다.

## 5. 과금 안전장치: 예산 알림 1달러
1. 위쪽 검색창에 **Budgets** 입력 → **AWS Budgets** → **예산 생성**(Create budget).
2. **템플릿 사용(간소화)** → **월별 비용 예산**(Monthly cost budget).
3. 예산 금액 **1** (USD), 알림을 받을 **이메일** 입력 → **예산 생성**.

## 6. GitHub에 두 값 등록
1. https://github.com/saysolover/cinema_alert → **Settings** → **Secrets and variables** → **Actions**
   → **New repository secret** 을 두 번:
   - 이름 `DTRYX_RELAY_URL` / 값: 4단계에서 복사한 함수 URL (끝의 `/`는 있어도 없어도 됩니다)
   - 이름 `DTRYX_RELAY_TOKEN` / 값: 0단계의 토큰 (Lambda의 `RELAY_TOKEN`과 **똑같이**)
2. 끝나면 "AWS 설정 끝, 시크릿 등록 끝"이라고 알려 주세요. 제가 워크플로우를 다시 켜고 동작을 확인합니다.

---

## 문제가 생기면
- **GitHub 실행 로그에 `중계 토큰 불일치`**: Lambda의 `RELAY_TOKEN` 값과 GitHub 시크릿 값이 다릅니다. 둘 다 같은 토큰으로 다시 넣으세요.
- **함수 URL 주소가 브라우저에서 `Forbidden`(AWS 오류 화면)**: 함수 URL 권한 문제입니다. 구성 → 권한 → 리소스 기반 정책에
  `lambda:InvokeFunctionUrl` 이 있는지 확인하세요. 함수 URL을 만들 때 자동으로 추가되는 것이 정상입니다. 해결이 안 되면 화면을 알려 주세요.
- **함수 URL을 브라우저에 열면 `forbidden`(작은 글자 한 줄)**: 정상입니다. 토큰이 없어서 거부된 것이며 중계가 살아 있다는 뜻입니다.

## 안전 설계 (참고)
- 토큰이 없거나 틀리면 403으로 거부합니다. 토큰은 환경변수와 상수 시간 비교(`hmac.compare_digest`)로 확인합니다.
- 접속 대상은 `www.dtryx.com` 고정, GET만, 경로는 `/reserve/movie.do`, `/reserve/main_list.do`, `/reserve/showseq_list.do` 세 개뿐입니다. 열린 프록시가 아닙니다.
- 리다이렉트는 따라가지 않습니다.
- 예약 동시성 1과 예산 알림으로 토큰이 유출돼도 비용이 커지지 않게 합니다.
