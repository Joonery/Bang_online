# BANG! 온라인 보드게임 구현
주어지는 자료 및 코드를 분석하여, Bang_online repository에 보드게임 **BANG!**을 브라우저에서 4~7명이 온라인으로 플레이할 수 있는 self-hosted 웹 애플리케이션으로 구현해줘.

이번 작업에서 중요한 것은 빠르게 코드를 많이 생성하는 것이 아니라,

1. 제공된 룰북을 정확히 이해하고,
2. 기존 프로젝트의 배포/네트워크 패턴을 분석하고,
3. 미완성 Discord 봇에서 재사용 가능한 게임 로직을 파악하고,
4. 최소한의 서버 자원과 네트워크 트래픽으로 운영 가능한 구조를 설계한 뒤 구현하는 것이다.

## 1. 최종 목표
BANG! 온라인 게임을 구현한다. 클라이언트는 인터넷 브라우저만 있으면 별도 설치 없이 접속하여 플레이할 수 있어야 한다. 인원은 룰북에 명시된 대로 4-7명까지 지원하도록 만든다. 최종 결과물은 개인 Oracle 서버에 배포하여 운영할 것이고, 자원이 넉넉한 상용 서비스 환경이 아니므로 최소한의 runtime dependency를 갖는 단순한 구조로 만들고, 낮은 CPU/memory usage, 낮은 네트워크 트래픽을 지향하며, 단일 서버에서 쉽게 실행 가능하게 만든다. deploy를 어떻게 해야 하는지에 대한 문서를 docs/하위에 만든다.

---

## 2. 작업을 시작하기 전에 반드시 참고할 자료

### A. 공식 게임 룰북 PDF
우선 Bang_online/docs/BANG_Card_List.pdf 를 읽고 게임 규칙을 정리한다. 룰북에 있는 규칙을 **일반적인 BANG! 지식보다 우선한다.** 또한, docs/에 있는 Bang_나무위키_룰북.md 또한 비공식적 룰북이니 이를 참고할 것. 만일 룰북과 기존 코드베이스가 충돌한다면 룰북을 source of truth로 취급한다.


### B. 기존 Discord BANG! 봇
discord_bang_bot repository는 BANG!을 Discord bot으로 구현하려다가 중단한 코드이다. 해당 코드들을 모두 읽고,\
1) 재사용 가능한 로직을 추출하고
2) role.py에서 역할별 목표(__ROLE_LIST__)와 플레이어 수에 따른 역할 분배(__RolePerPlayer__), character.py에서 캐릭터별 hp와 효과 (__CHARACTER_LIST__), cards.py에서 카드별 문양과 번호, 카드 개수, 번역명, 효과 등의 내용(__CARD_DB__)을 가져와서 사용할 것.
이 코드베이스의 스타일이나 아키텍쳐를 따라갈 필요는 없다. 잘못 구현되어 있거나 룰북과 충돌하는 부분은 재사용하지 않는다.

### C. 세실고 보드게임 repository
Sesil_BoardGame 에, 같은 서버에 배포했던 기존 보드게임 코드가 있다. 이 코드베이스에서는 다음의 내용을 참고한다. 이 프로젝트의 **게임 로직을 복사하라는 뜻이 아니다.**
- 서버 실행 방식
- HTTP server 구조
- WebSocket 또는 실시간 통신 방식
- room 생성 방식
- player session 관리 방식
- reconnect 처리
- frontend serving 방식
- static asset serving 방식
- build 방식
- package/dependency 구성
- deployment 방식
- systemd / reverse proxy / nginx 등의 사용 여부
- Oracle 서버 환경에서 사용한 설정
- 네트워크 트래픽을 줄이기 위해 사용한 방법

배포와 네트워크 구조 중 현재 BANG! 프로젝트에도 적합한 패턴이 있다면 최대한 재사용한다.
새로운 framework나 dependency를 도입하기 전에 기존 구현으로 해결할 수 있는지 먼저 검토하라.

### D. 카드 이미지
Bang_online/src/ 하위 디렉토리에 카드 이미지 리소스가 존재한다. playing_card에는 파란 테두리의 장착형, 사용형 카드들의 이미지가 있고, character_card에는 캐릭터 16종이, role_card에는 역할 카드 4종이 있다. 게임 구현 시 이 이미지들을 사용할 것인데, 파일명과 __CARD_DB__ 에 있는 한글 번역명을 매칭시켜서 올바르게 사용해야 한다.

---

## 3. Source of truth priority
충돌하는 정보가 있을 경우 룰북 pdf > 이 프롬프트에 적힌 요구사항 > 일반적인 BANG! 규칙에 대한 사전 지식을 따른다. 룰북에 없는 내용을 임의로 게임 규칙으로 추가하지 않는다. 규칙이 불명확하거나 자료 사이에 충돌이 있다면 추측으로 숨기지 말고 어떻게 처리하고 판단하였는지 명시적으로 출력하라.

---

## 4. 작업 고려사항

먼저 각 룰에 대해 충분히 조사하고 구현 구조를 만든다. 그 후, Sesil_BoardGame에서 서버/클라이언트/네트워크 관련 재사용할 아키텍쳐 패턴을 정리한다. 
- 게임 세션이 여러 개 있어야 하는 게 아니라, 단일한 세션 한개만 링크로 접속하면 된다.
- 종속성이 최소화되는 방향으로 네트워크를 구현한다. 현재 오라클 서버에는 nodejs 말고는 아무것도 없다. Sesil_BoardGame 에서 요구하는 것 이상의 종속성을 포함하지 않도록 한다. 
- 셔플과 랜덤 선택은 서버에서 수행한다.
- 클라이언트는 타 플레이어의 손패, 숨겨진 역할, deck 순서 등 hidden state를 몰라야 한다. 단지 사용자 입력을 보내고 결과만 표시한다. API response / WebSocket message 자체가 플레이어별로 필요한 정보만 포함해야 한다.
- Sesil_BoardGame 처럼 global log와 채팅창이 포함되어야 한다. global log에 누가 무엇을 사용하고, 어떤 효과가 발동되었는지, 감옥 탈출 여부나 다이너마이트 폭발 여부, 캐릭터의 효과 사용 여부 등등이 모두 볼 수 있게 기록된다. 이 로그는 세션이 켜져있는 동안만 유효하고, 세션이 종료되면 없어지게 한다.

---

## 5. 게임의 일반적인 흐름도
1. 처음에 접속한 host가 방 생성 (1개의 세션만 가능) 및 url 생성
2. 다른 플레이어가 url로 참가
3. nickname 설정
4. 4~7명 입장
5. 입장이 완료되면 host가 게임 시작
6. 역할 배분
7. 캐릭터 선택 또는 룰북에 맞는 캐릭터 배분
8. 게임 시작
9. 정상적인 turn 진행
10. death 처리
11. victory 판정
12. 게임 종료
13. 새 게임 시작

---

## 6. Reconnect

실제 플레이 중 browser refresh 또는 일시적인 연결 끊김이 발생해도 게임 전체가 망가지지 않아야 한다.
가능하면 lightweight session token을 사용한다. 새 dependency를 추가하지 않고 해결할 수 있다면 그렇게 한다.

재접속 시:
- 동일 player identity 복구
- 자신의 private hand 복구
- 현재 게임 상태 복구
- 현재 turn / pending action 복구

가 가능해야 한다. 서버 프로세스 자체가 종료된 뒤까지 게임을 반드시 영속화할 필요가 있는지는 기존 프로젝트 구조와 복잡도를 보고 판단한다. persistent storage가 필요하지 않다면 DB를 억지로 추가하지 않는다.

---

## 7. Network traffic 최소화

Oracle 개인 서버 운영을 고려하여 불필요한 통신을 피한다.

특히:
- polling보다 기존 infrastructure가 허용한다면 WebSocket/event 방식 우선 검토
- 매 이벤트마다 모든 이미지나 정적 데이터를 재전송하지 않기
- static assets는 브라우저 cache가 가능하게 하기
- 전체 game state를 무조건 반복 전송하지 않기
- 가능한 경우 변경된 state/event 중심으로 통신
- private/public state를 분리

단, 트래픽을 몇 KB 줄이기 위해 architecture를 과도하게 복잡하게 만들지는 않는다.

---

## 8. BANG! rule engine

규칙을 UI event handler 안에 흩뿌리지 않는다.

게임 엔진에서 최소한 다음 개념들이 명시적으로 모델링되어야 한다.

- Game
- Player
- Role
- Character
- Card
- Deck
- Discard pile
- Turn
- Phase
- Action
- Target
- Equipment
- Pending interaction
- Death
- Victory condition

상황에 따라 명칭은 변경할 수 있지만 의미는 유지한다.

카드별 동작을 거대한 하나의 if/else 덩어리로 만들기보다 현재 언어와 코드베이스에 적합한 data-driven 또는 handler 기반 설계를 고려한다.

단, abstraction을 위한 abstraction은 만들지 않는다.

---

## 9. Pending interaction 설계

BANG!에는 한 플레이어의 카드 사용 이후 다른 플레이어의 응답을 기다리는 경우가 존재한다.

예:

- Bang! → Missed!
- Duel
- Indians!
- General Store
- Barrel 관련 판정
- 기타 룰북에서 interaction을 요구하는 카드

이런 상황을 단순한 synchronous 함수 호출처럼 취급하지 않는다.

네트워크 게임이므로 서버가 명시적인 pending interaction / resolution state를 유지해야 한다.

브라우저 refresh나 reconnect 이후에도 현재 무엇을 기다리고 있는지 복구할 수 있는 형태로 설계한다.

---

## 10. Validation

모든 player action은 서버에서 검증한다.

예:
- 현재 자기 turn인가?
- 현재 phase에서 사용할 수 있는 카드인가?
- 실제로 해당 카드를 가지고 있는가?
- 대상이 유효한가?
- 사거리 안인가?
- Bang! 사용 횟수 제한에 걸리지 않는가?
- 해당 캐릭터 능력으로 가능한 행동인가?
- 이미 죽은 플레이어가 아닌가?
- 현재 pending interaction의 응답자로 지정된 플레이어인가?

잘못된 요청은 game state를 변경하지 않는다.

---

## 11. UI/UX

- 전체 디자인은 **서부극 / Spaghetti Western / Wanted poster** 느낌으로 만든다. 권장 visual direction은 다음과 같다. 별도 외부 소스를 사용하지 말고 웹에서 구현 가능한 정도만 할 것.
    - 낡은 목재 테이블
    - parchment / aged paper
    - wanted poster
    - 황동 또는 낡은 철제 장식
    - sheriff badge
    - revolver cylinder 또는 bullet motif
    - saloon 느낌의 typography
    - 카드 테이블 느낌의 중앙 play area
- readability와 usability를 희생하지 않는다.
- animation은 적당하게 사용하되 과한 건 피한다. low-end browser에서도 부드럽게 동작해야 한다.
- 우측 상단부에 룰북을 간단하게 읽을 수 있는 창이 뜨는 버튼을 만들 것.
- 모든 카드에 대한 정보를 볼 수 있는 딕셔너리 버튼도 추가해 모든 카드 설명을 찾아볼 수 있게 할 것.
- 자신의 hand는 화면 아래에 배치한다 (desktop 기준)
- mobile에서도 잘 작동해야 한다. 

---

## 12. Card UI

`src`에 있는 실제 카드 이미지를 사용한다. 이미지 용량 때문에 네트워크 낭비가 심한 경우 기존 파일을 손상시키지 않는 범위에서 caching / thumbnail 전략을 검토할 수 있다.

---

## 13. 게임 로그

텍스트 기반 game log를 제공한다.

예 (예시는 영어로 되어있지만 한글로 모두 표시되어야 함) :
- Alice drew 2 cards.
- Bob played Bang! on Carol.
- Carol played Missed!.
- Dave lost 1 HP.
- Eve was eliminated.
- Eve was an Outlaw.

다만 private information이 log를 통해 노출되지 않도록 한다.
각 플레이어에게 공개 가능한 log와 private notification을 구분한다.

---

## 14. Dependency 정책

새 dependency를 설치하기 전 다음 순서로 판단한다.
1. 표준 라이브러리로 쉽게 해결 가능한가?
2. 현재 repository dependency로 해결 가능한가?
3. 기존 보드게임 repository에서 이미 검증된 dependency가 있는가?
4. 그래도 필요한가?

3~5줄로 직접 구현할 기능을 위해 큰 dependency를 추가하지 않는다.

특히 다음은 명백한 필요성이 없다면 추가하지 않는다.

- database
- Redis
- message queue
- container orchestration
- state management framework
- CSS framework
- UI component framework
- ORM

기존 repository가 이미 사용하는 기술이라면 별도로 판단한다.

---

## 15. 금지 사항

다음 행동은 하지 않는다.

- 룰북을 읽지 않고 기억에 의존하여 구현
- 6인 전용 하드코딩
- 다른 플레이어의 hidden card/role을 client에 전송
- client-side 승패 판정
- client-side deck shuffle
- 필요 없는 database 도입
- 필요 없는 authentication system 도입
- 필요 없는 frontend framework 도입
- 존재하는 card asset 대신 placeholder 사용
- repository 전체를 이유 없이 rewrite
- 테스트 없이 핵심 rule implementation 완료 처리
- TODO로 핵심 게임 규칙을 남겨놓고 완료 선언
- 임의로 rule을 단순화하고 알리지 않는 것

---

## 16. 불확실한 규칙 처리

룰북에서 해석이 애매한 부분이 있으면 임의로 숨겨서 결정하지 않는다.

다음 파일을 만들거나 기존 문서에 별도 section을 만든다.

`RULE_ASSUMPTIONS.md`

각 항목에는 다음을 기록한다.

- 관련 규칙
- 룰북에서 확인한 내용
- 모호한 부분
- 현재 구현에서 선택한 해석
- 해당 코드 위치

명확한 룰은 이 문서에 넣을 필요 없다.