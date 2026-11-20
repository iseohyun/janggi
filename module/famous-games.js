/**
 * @fileoverview 유명 기보 목록 (왼쪽 서랍 "저장된 기보" 영역 아래). 누르면 그 기보를 불러온다 (record.js importRecordFromText).
 * - 기보 글은 앱의 기보 텍스트 형식 그대로 둔다 (상차림·대국자·대회명·대국정보 + "N. 초 79졸78" 수순).
 * - 수순은 사실 정보로 보고 해설은 넣지 않는다. 출처는 각 항목의 source에 적는다.
 * - 다른 기보를 더하려면 FAMOUS_GAMES에 같은 꼴로 넣는다.
 * - 프로 대국 묶음은 data/famous-games.json(있을 때만)에서 읽어 FAMOUS_GAMES 뒤에 붙인다. 파일이 없거나 file://로 열면 내장 기보만 보인다.
 *   형식: {games:[{id, event, round, year, date, cho, han, opening, layout:[초,한], n, result, srcPath, m:"79졸78 41병42 ..."}]}
 *   기보 글은 famousGameText가 수순(m)으로 만든다. 만드는 곳: 저장소 밖 작업 폴더 scripts/build-famous.mjs
 * - 검색·필터: 검색어(대회명·대국자명), 포진, 연도. 맞는 기보를 FAMOUS_PAGE개씩 보여 주고 "더 보기"로 늘린다.
 *   기보가 FAMOUS_FILTER_MIN개 이상일 때만 필터 줄을 보인다.
 * - "저장된 기보" 영역은 두 묶음: 내 기보(직접 저장하거나 불러온 대국, 위) / 유명 기보(아래). 묶음 머리를 누르면 접힌다
 *   (toggleRecordGroup, localStorage "recordGroupCollapsed_<묶음>"). 내 기보가 없으면 그 묶음은 숨긴다 (syncRecordGroups).
 * @module famous-games
 * @depends record, ui
 */

const FAMOUS_GAMES = [
  {
    id: "2007-myungin-final-1",
    title: "제15회 명인전 결승 제1국",
    year: 2007,
    players: "김기영 3단 vs 황문수 9단",
    event: "제15회 명인전",
    cho: "김기영 3단",
    han: "황문수 9단",
    opening: "귀마 대 귀마 (엇상)",
    moves: 139,
    result: "외통",
    source: "janggi.pl 보관본 (Wayback 2017-01), 원본 오타 8곳 보정",
    text: "상차림: 초하(마상마상) vs 한상(마상마상)\n초나라: 김기영 3단\n한나라: 황문수 9단\n대회명: 제15회 명인전\n대국정보: 결승 제1국 (2007)\n총평: 원본은 janggi.pl 보관본(Antonio Barra 입력). 원본 오타 8곳을 앞뒤 수순에 맞춰 보정했고, 해설은 넣지 않음\n\n1. 초 79졸78\n2. 한 41병42\n3. 초 02마83\n4. 한 12마33\n5. 초 82포85\n6. 한 32포35\n7. 초 75졸74\n8. 한 17마36\n9. 초 03상75\n10. 한 45병46\n11. 초 08상76\n12. 한 13상45\n13. 초 04사94\n14. 한 25궁26\n15. 초 06사96\n16. 한 11차51\n17. 초 77졸67\n18. 한 16사25\n19. 초 07마86\n20. 한 35포15\n21. 초 09차99\n22. 한 38포35\n23. 초 88포68\n24. 한 45상73\n25. 초 74졸73\n26. 한 51차56\n27. 초 01차07\n28. 한 33마45\n29. 초 95궁06\n30. 한 15포13\n31. 초 71졸72\n32. 한 13포17\n33. 초 73졸74\n34. 한 43병53\n35. 초 78졸77\n36. 한 26궁16\n37. 초 68포62\n38. 한 14사24\n39. 초 62포02\n40. 한 42병52\n41. 초 96사95\n42. 한 47병48\n43. 초 76상48 (장군)\n44. 한 49병48\n45. 초 99차19\n46. 한 17포19\n47. 초 72졸73\n48. 한 19포17\n49. 초 07차09\n50. 한 16궁15\n51. 초 06궁05\n52. 한 48병47\n53. 초 09차29\n54. 한 17포13\n55. 초 02포06\n56. 한 56차58\n57. 초 29차27\n58. 한 58차48\n59. 초 83마71\n60. 한 48차49\n61. 초 67졸66\n62. 한 13포16\n63. 초 66졸56\n64. 한 49차59\n65. 초 77졸67\n66. 한 15궁14\n67. 초 05궁04\n68. 한 16포34\n69. 초 71마83\n70. 한 53병54\n71. 초 56졸46\n72. 한 47병46\n73. 초 85포05\n74. 한 52병53\n75. 초 67졸57\n76. 한 34포16\n77. 초 75상07\n78. 한 59차69\n79. 초 57졸47\n80. 한 45마66\n81. 초 47졸37\n82. 한 36마15\n83. 초 27차17\n84. 한 16포34\n85. 초 17차18\n86. 한 53병63\n87. 초 18차48\n88. 한 46병47\n89. 초 48차98\n90. 한 54병53\n91. 초 06포84\n92. 한 63병73\n93. 초 74졸73\n94. 한 66마54\n95. 초 86마65\n96. 한 54마73\n97. 초 65마73\n98. 한 69차63\n99. 초 98차78\n100. 한 53병54\n101. 초 83마71\n102. 한 63차53\n103. 초 71마52\n104. 한 54병64\n105. 초 05포03\n106. 한 64병63\n107. 초 78차58\n108. 한 53차23\n109. 초 58차68\n110. 한 25사26\n111. 초 03포63\n112. 한 14궁25\n113. 초 63포03\n114. 한 23차21\n115. 초 03포05\n116. 한 15마23\n117. 초 73마54\n118. 한 24사14\n119. 초 54마35\n120. 한 23마35\n121. 초 68차65\n122. 한 25궁16\n123. 초 65차35\n124. 한 14사25\n125. 초 35차45\n126. 한 21차51\n127. 초 07상75\n128. 한 47병57\n129. 초 45차48\n130. 한 16궁15\n131. 초 75상43 (장군)\n132. 한 15궁14\n133. 초 48차44\n134. 한 14궁24\n135. 초 43상11\n136. 한 51차11\n137. 초 44차34 (장군)\n138. 한 24궁34\n139. 초 52마44 (외통)\n"
  },
  {
    "id": "2007-myungin-final-2",
    "title": "제15회 명인전 결승 제2국",
    "year": 2007,
    "players": "황문수 9단 vs 김기영 3단",
    "event": "제15회 명인전",
    "cho": "황문수 9단",
    "han": "김기영 3단",
    "opening": "귀마 대 귀마 (엇상)",
    "moves": 160,
    "result": "한 판정승",
    "source": "janggi.pl 보관본 (Wayback 2017-01, game-2-myonyin-tournament), 원본 오타 8곳을 앞뒤 수순과 앱 규칙에 맞춰 보정(40수 C38-37→38-32, 53수 C94:P44→94-64, 55수 C44-84→64-84, 65수 C96-95→96-95, 108수 R33-93→43-93, 110수 R94-98→93-98, 122수 C16-14→17-14, 158수 P:P56→46-56). 원문 번호 오타: 145. 이 두 번 나와 두 번째를 146수로 봄",
    "text": "상차림: 초하(상마상마) vs 한상(상마상마)\n초나라: 황문수 9단\n한나라: 김기영 3단\n대회명: 제15회 명인전\n대국정보: 결승 제2국 (2007)\n총평: 원본은 janggi.pl 보관본(Antonio Barra 입력). 결과 한 판정승 (시간 종료, 3.5점 차). 원본 오타 8곳을 앞뒤 수순과 앱 규칙에 맞춰 보정(40수 C38-37→38-32, 53수 C94:P44→94-64, 55수 C44-84→64-84, 65수 C96-95→96-95, 108수 R33-93→43-93, 110수 R94-98→93-98, 122수 C16-14→17-14, 158수 P:P56→46-56). 원문 번호 오타: 145. 이 두 번 나와 두 번째를 146수로 봄. 해설은 넣지 않음\n\n1. 초 71졸72\n2. 한 49병48\n3. 초 08마87\n4. 한 18마37\n5. 초 88포85\n6. 한 38포35\n7. 초 75졸76\n8. 한 13마34\n9. 초 07상75\n10. 한 45병44\n11. 초 03마84\n12. 한 25궁24\n13. 초 82포62\n14. 한 14사25\n15. 초 73졸63\n16. 한 35포15\n17. 초 75상43\n18. 한 44병43\n19. 초 62포64\n20. 한 12상44\n21. 초 64포94\n22. 한 24궁14\n23. 초 63졸53\n24. 한 43병53\n25. 초 94포44\n26. 한 25사24\n27. 초 44포94\n28. 한 16사25\n29. 초 94포99\n30. 한 19차18\n31. 초 76졸75\n32. 한 47병46\n33. 초 09차08\n34. 한 37마56\n35. 초 77졸76\n36. 한 32포38\n37. 초 08차07\n38. 한 48병47\n39. 초 99포94\n40. 한 38포32\n41. 초 76졸66\n42. 한 56마48\n43. 초 07차09\n44. 한 32포37\n45. 초 09차89\n46. 한 18차19\n47. 초 84마65\n48. 한 53병54\n49. 초 02상74\n50. 한 46병45\n51. 초 66졸56\n52. 한 19차59\n53. 초 94포64\n54. 한 59차56\n55. 초 64포84\n56. 한 47병46\n57. 초 79졸78\n58. 한 48마67\n59. 초 06사96\n60. 한 37포31\n61. 초 01차41\n62. 한 56차96\n63. 초 95궁96\n64. 한 31포36\n65. 초 96궁95\n66. 한 11차41\n67. 초 78졸68\n68. 한 67마55\n69. 초 72졸73\n70. 한 15포13\n71. 초 89차19\n72. 한 55마47\n73. 초 73졸63\n74. 한 47마26\n75. 초 19차59\n76. 한 34마55\n77. 초 63졸64\n78. 한 14궁15\n79. 초 64졸54\n80. 한 55마47\n81. 초 59차58\n82. 한 15궁16\n83. 초 68졸67\n84. 한 41차43\n85. 초 67졸57\n86. 한 47마39\n87. 초 58차59\n88. 한 39마18\n89. 초 84포06\n90. 한 18마37\n91. 초 74상46\n92. 한 45병46\n93. 초 65마44\n94. 한 17상49\n95. 초 57졸47\n96. 한 46병47\n97. 초 44마36\n98. 한 25사36\n99. 초 59차55\n100. 한 13포17\n101. 초 87마68\n102. 한 24사34\n103. 초 75졸76\n104. 한 34사25\n105. 초 76졸75\n106. 한 47병46\n107. 초 55차59\n108. 한 43차93\n109. 초 95궁05\n110. 한 93차98\n111. 초 68마76\n112. 한 98차58\n113. 초 59차58\n114. 한 37마58\n115. 초 04사95\n116. 한 49상77\n117. 초 95사96\n118. 한 26마38\n119. 초 54졸55\n120. 한 36사26\n121. 초 75졸65\n122. 한 17포14\n123. 초 76마64\n124. 한 14포36\n125. 초 05궁95\n126. 한 58마79\n127. 초 64마83\n128. 한 79마98\n129. 초 06포66\n130. 한 77상49\n131. 초 66포06\n132. 한 98마77\n133. 초 96사86\n134. 한 77마65\n135. 초 83마75\n136. 한 65마73\n137. 초 85포05\n138. 한 16궁15\n139. 초 75마63\n140. 한 49상77\n141. 초 86사96\n142. 한 15궁14\n143. 초 63마42\n144. 한 36포39\n145. 초 06포84\n146. 한 39포35\n147. 초 55졸54\n148. 한 14궁15\n149. 초 42마23\n150. 한 15궁16\n151. 초 23마35\n152. 한 25사35\n153. 초 54졸55\n154. 한 35사36\n155. 초 84포06\n156. 한 73마81\n157. 초 55졸56\n158. 한 46병56\n159. 초 06포56\n160. 한 81마93\n"
  },
  {
    "id": "2007-myungin-final-3",
    "title": "제15회 명인전 결승 제3국",
    "year": 2007,
    "players": "김기영 3단 vs 황문수 9단",
    "event": "제15회 명인전",
    "cho": "김기영 3단",
    "han": "황문수 9단",
    "opening": "귀마 대 귀마 (엇상)",
    "moves": 107,
    "result": "초 승",
    "source": "janggi.pl 보관본 (Wayback 2017-01, game-3-myonyin-tournament), 원본 오타 1곳을 앞뒤 수순과 앱 규칙에 맞춰 보정(44수 P45-44→43-44)",
    "text": "상차림: 초하(마상마상) vs 한상(마상마상)\n초나라: 김기영 3단\n한나라: 황문수 9단\n대회명: 제15회 명인전\n대국정보: 결승 제3국 (2007)\n총평: 원본은 janggi.pl 보관본(Antonio Barra 입력). 결과 초 승 (원문 표기 1/0). 원본 오타 1곳을 앞뒤 수순과 앱 규칙에 맞춰 보정(44수 P45-44→43-44). 해설은 넣지 않음\n\n1. 초 79졸78\n2. 한 41병42\n3. 초 02마83\n4. 한 12마33\n5. 초 82포85\n6. 한 32포35\n7. 초 75졸74\n8. 한 17마36\n9. 초 03상75\n10. 한 45병46\n11. 초 88포68\n12. 한 13상45\n13. 초 68포98\n14. 한 11차51\n15. 초 07마86\n16. 한 33마12\n17. 초 98포94\n18. 한 12마24\n19. 초 77졸67\n20. 한 51차59\n21. 초 09차59\n22. 한 49병59\n23. 초 71졸72\n24. 한 38포08\n25. 초 94포98\n26. 한 25궁26\n27. 초 01차51\n28. 한 16사25\n29. 초 06사96\n30. 한 59병69\n31. 초 04사94\n32. 한 69병79\n33. 초 78졸79\n34. 한 19차79\n35. 초 51차58\n36. 한 35포15\n37. 초 58차18\n38. 한 47병48\n39. 초 18차17\n40. 한 15포13\n41. 초 17차27\n42. 한 26궁16\n43. 초 67졸66\n44. 한 43병44\n45. 초 83마71\n46. 한 79차76\n47. 초 27차67\n48. 한 46병56\n49. 초 66졸56\n50. 한 76차56\n51. 초 85포05\n52. 한 56차57\n53. 초 67차69\n54. 한 57차97\n55. 초 95궁06\n56. 한 13포15\n57. 초 69차09\n58. 한 45상68\n59. 초 94사95\n60. 한 24마45\n61. 초 09차08\n62. 한 45마66\n63. 초 08차07\n64. 한 97차87\n65. 초 95사84\n66. 한 25사26\n67. 초 96사95\n68. 한 14사25\n69. 초 98포92\n70. 한 42병43\n71. 초 92포62\n72. 한 68상45\n73. 초 73졸63\n74. 한 87차07\n75. 초 05포07\n76. 한 66마87\n77. 초 06궁05\n78. 한 44병54\n79. 초 62포82\n80. 한 87마66\n81. 초 07포03\n82. 한 43병44\n83. 초 05궁04\n84. 한 15포17\n85. 초 71마52\n86. 한 45상68\n87. 초 03포06\n88. 한 66마87\n89. 초 06포36\n90. 한 26사36\n91. 초 52마44\n92. 한 17포14\n93. 초 84사94\n94. 한 87마66\n95. 초 82포62\n96. 한 66마87\n97. 초 44마56\n98. 한 48병47\n99. 초 56마68\n100. 한 14포74\n101. 초 86마74\n102. 한 87마75\n103. 초 68마47\n104. 한 75마56\n105. 초 74마66\n106. 한 한수쉼\n107. 초 66마54\n"
  },
  {
    "id": "2007-kiseong-final-1",
    "title": "제2회 기성전 결승 제1국",
    "year": 2007,
    "players": "김건준 9단 vs 하성호 8단",
    "event": "제2회 기성전",
    "cho": "김건준 9단",
    "han": "하성호 8단",
    "opening": "귀마 대 귀마 (엇상)",
    "moves": 63,
    "result": "초 기권승",
    "source": "janggi.pl 보관본 (Wayback 2017-01, game-4-2-kieseong-tournament), 원본 오타 1곳을 앞뒤 수순과 앱 규칙에 맞춰 보정(21수 C89-86→88-86). 64수에 기권 (원문 \"64. Resigns\")",
    "text": "상차림: 초하(상마상마) vs 한상(상마상마)\n초나라: 김건준 9단\n한나라: 하성호 8단\n대회명: 제2회 기성전\n대국정보: 결승 제1국 (2007)\n총평: 원본은 janggi.pl 보관본(Antonio Barra 입력). 결과 초 기권승 (64수째 한 기권). 원본 오타 1곳을 앞뒤 수순과 앱 규칙에 맞춰 보정(21수 C89-86→88-86). 64수에 기권 (원문 \"64. Resigns\"). 해설은 넣지 않음\n\n1. 초 71졸72\n2. 한 49병48\n3. 초 08마87\n4. 한 13마34\n5. 초 88포85\n6. 한 19차29\n7. 초 75졸76\n8. 한 32포35\n9. 초 07상75\n10. 한 45병44\n11. 초 03마84\n12. 한 17상45\n13. 초 06사96\n14. 한 18마37\n15. 초 01차61\n16. 한 44병54\n17. 초 95궁06\n18. 한 38포36\n19. 초 85포88\n20. 한 29차28\n21. 초 88포86\n22. 한 16사26\n23. 초 82포85\n24. 한 36포16\n25. 초 79졸78\n26. 한 16포13\n27. 초 04사95\n28. 한 41병42\n29. 초 61차11\n30. 한 13포11\n31. 초 86포04\n32. 한 54병53\n33. 초 09차69\n34. 한 12상44\n35. 초 73졸63\n36. 한 53병52\n37. 초 02상74\n38. 한 44상76\n39. 초 77졸76\n40. 한 11포16\n41. 초 87마66\n42. 한 16포56\n43. 초 66마54\n44. 한 35포55\n45. 초 76졸66\n46. 한 56포76\n47. 초 06궁05\n48. 한 25궁16\n49. 초 69차39\n50. 한 28차27\n51. 초 39차19\n52. 한 16궁25\n53. 초 66졸56\n54. 한 43병44\n55. 초 56졸55\n56. 한 76포74\n57. 초 75상47\n58. 한 44병54\n59. 초 55졸45\n60. 한 34마55\n61. 초 45졸35\n62. 한 25궁24\n63. 초 35졸25\n"
  },
  {
    "id": "2007-kiseong-final-2",
    "title": "제2회 기성전 결승 제2국",
    "year": 2007,
    "players": "하성호 8단 vs 김건준 9단",
    "event": "제2회 기성전",
    "cho": "하성호 8단",
    "han": "김건준 9단",
    "opening": "귀마 대 귀마 (엇상)",
    "moves": 76,
    "result": "한 기권승",
    "source": "janggi.pl 보관본 (Wayback 2017-01, game-5-2-kieseong-tournament), 원본 오타 2곳을 앞뒤 수순과 앱 규칙에 맞춰 보정(12수 A12-24→14-24, 52수 R52-22→42-22). 77수에 기권 (원문 \"77. Resigns\")",
    "text": "상차림: 초하(마상마상) vs 한상(마상마상)\n초나라: 하성호 8단\n한나라: 김건준 9단\n대회명: 제2회 기성전\n대국정보: 결승 제2국 (2007)\n총평: 원본은 janggi.pl 보관본(Antonio Barra 입력). 결과 한 기권승 (77수째 초 기권). 원본 오타 2곳을 앞뒤 수순과 앱 규칙에 맞춰 보정(12수 A12-24→14-24, 52수 R52-22→42-22). 77수에 기권 (원문 \"77. Resigns\"). 해설은 넣지 않음\n\n1. 초 79졸78\n2. 한 41병42\n3. 초 02마83\n4. 한 12마33\n5. 초 82포85\n6. 한 32포35\n7. 초 75졸74\n8. 한 17마36\n9. 초 03상75\n10. 한 45병46\n11. 초 07마86\n12. 한 14사24\n13. 초 95궁05\n14. 한 11차51\n15. 초 04사95\n16. 한 25궁14\n17. 초 09차69\n18. 한 16사25\n19. 초 08상76\n20. 한 35포15\n21. 초 75상43\n22. 한 42병43\n23. 초 69차63\n24. 한 51차41\n25. 초 85포81\n26. 한 41차42\n27. 초 73졸72\n28. 한 13상41\n29. 초 83마75\n30. 한 43병44\n31. 초 81포87\n32. 한 15포13\n33. 초 63차69\n34. 한 13포16\n35. 초 87포84\n36. 한 46병45\n37. 초 01차03\n38. 한 16포13\n39. 초 03차02\n40. 한 18상46\n41. 초 06사96\n42. 한 38포34\n43. 초 74졸64\n44. 한 47병57\n45. 초 69차66\n46. 한 49병48\n47. 초 84포06\n48. 한 19차09\n49. 초 64졸63\n50. 한 45병55\n51. 초 63졸53\n52. 한 42차22\n53. 초 88포85\n54. 한 46상74\n55. 초 02차03\n56. 한 55병54\n57. 초 53졸43\n58. 한 54병64\n59. 초 43졸33\n60. 한 13포03\n61. 초 33졸34\n62. 한 24사34\n63. 초 77졸67\n64. 한 22차23\n65. 초 67졸57\n66. 한 03포13\n67. 초 66차67\n68. 한 23차03\n69. 초 95사04\n70. 한 74상06\n71. 초 96사06\n72. 한 64병74\n73. 초 75마56\n74. 한 74병84\n75. 초 85포88\n76. 한 03차04\n"
  }
];

/** 묶음 머리: 내 기보 / 유명 기보 접기·펴기 */
function toggleRecordGroup(group) {
  const box = document.getElementById(`record-group-${group}`);
  if (!box) return;
  const collapsed = !box.classList.contains("collapsed");
  recordGroupSetCollapsed(group, collapsed);
  try {
    localStorage.setItem(`recordGroupCollapsed_${group}`, collapsed ? "1" : "0");
  } catch (e) {
    // 저장 못 해도 이번 화면에서는 동작
  }
}

function recordGroupSetCollapsed(group, collapsed) {
  const box = document.getElementById(`record-group-${group}`);
  if (!box) return;
  box.classList.toggle("collapsed", collapsed);
  const head = box.querySelector(".record-group-head");
  if (head) head.setAttribute("aria-expanded", collapsed ? "false" : "true");
}

/**
 * 내 기보 묶음을 기보 수에 맞춥니다 (record.js updateSavedRecordsListUI가 부름).
 * @param {number} count - 내 기보 수
 */
function syncRecordGroups(count) {
  const mine = document.getElementById("record-group-mine");
  if (mine) mine.hidden = count === 0;
  const mineCount = document.getElementById("record-group-mine-count");
  if (mineCount) mineCount.textContent = count ? String(count) : "";
  const famousCount = document.getElementById("record-group-famous-count");
  if (famousCount) famousCount.textContent = String(famousAll().length);
}

// ===== 프로 대국 묶음 (data/famous-games.json) =====
const FAMOUS_DATA_URL = "data/famous-games.json";
/**
 * 프로 대국 묶음을 읽을지. 장기도사 이용 허락 전에는 로컬 검수용으로만 쓴다:
 * data/famous-games.json은 .gitignore에 있어 배포되지 않고, localhost·127.0.0.1에서 열 때만 읽는다.
 * 허락을 받아 배포할 때는 true로 바꾸고 .gitignore에서 뺀다.
 */
const FAMOUS_DATA_ENABLED = ["localhost", "127.0.0.1"].includes(window.location.hostname);
const FAMOUS_PAGE = 30; // 한 번에 보이는 줄 수
const FAMOUS_FILTER_MIN = 5; // 이보다 적으면 필터 줄을 숨긴다
let famousExtra = []; // 파일에서 읽은 기보
const famousFilter = { q: "", opening: "", year: "" };
let famousShown = FAMOUS_PAGE;

/** 내장 기보 + 파일 기보 */
function famousAll() {
  return FAMOUS_GAMES.concat(famousExtra);
}

/** 파일 기보 한 판의 기보 글 (record.js importRecordFromText가 읽는 형식) */
function famousGameText(g) {
  if (g.text) return g.text;
  const info = [g.round, g.date || (g.year ? String(g.year) : "")].filter(Boolean).join(" · ") || "미상";
  const moves = (g.m || "").split(" ").filter(Boolean).map((m, k) => `${k + 1}. ${k % 2 === 0 ? "초" : "한"} ${m}`);
  return [
    `상차림: 초하(${g.layout[0]}) vs 한상(${g.layout[1]})`,
    `초나라: ${g.cho}`,
    `한나라: ${g.han}`,
    `대회명: ${g.event}`,
    `대국정보: ${info}`,
    `총평: 출처 장기도사 기보 자료실(${g.srcPath || "홈페이지 기보"}). 결과 ${g.result}. 해설은 넣지 않음`,
    "",
    ...moves
  ].join("\n") + "\n";
}

/** 목록 줄에 쓰는 값 (내장 기보와 파일 기보의 이름 차이를 맞춘다) */
function famousRow(g) {
  return {
    title: g.title || [g.event, g.round].filter(Boolean).join(" "),
    year: g.year || null,
    players: g.players || `${g.cho} vs ${g.han}`,
    moves: g.moves || g.n,
    result: g.result,
    opening: g.opening || "",
    source: g.source || "장기도사 기보 자료실 (janggidosa.co.kr)"
  };
}

/** "2010 제3회 ..."처럼 연도를 앞에 붙인다. 대회명에 이미 그 연도가 있으면 붙이지 않는다 */
function famousTitleWithYear(r) {
  if (!r.year || r.title.includes(String(r.year))) return r.title;
  return `${r.year} ${r.title}`;
}

function famousMatches(g) {
  const f = famousFilter;
  if (f.opening && g.opening !== f.opening) return false;
  if (f.year && String(g.year || "미상") !== f.year) return false;
  if (f.q) {
    const hay = [g.title, g.event, g.round, g.players, g.cho, g.han].filter(Boolean).join(" ").toLowerCase().replace(/\s+/g, "");
    const words = f.q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.every(w => hay.includes(w))) return false;
  }
  return true;
}

/** 필터 줄의 포진·연도 고르기 칸을 지금 기보로 채운다 */
function famousFillFilterOptions() {
  const all = famousAll();
  const bar = document.getElementById("famous-filter");
  if (bar) bar.hidden = all.length < FAMOUS_FILTER_MIN;
  const fill = (id, label, values, current) => {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.replaceChildren(new Option(label, ""));
    values.forEach(([v, n]) => sel.add(new Option(`${v} (${n})`, v)));
    sel.value = values.some(([v]) => v === current) ? current : "";
  };
  const count = key => {
    const m = new Map();
    all.forEach(g => {
      const v = key(g);
      if (v) m.set(v, (m.get(v) || 0) + 1);
    });
    return [...m];
  };
  fill("famous-filter-opening", "포진 전체", count(g => g.opening).sort((a, b) => b[1] - a[1]), famousFilter.opening);
  fill("famous-filter-year", "연도 전체", count(g => String(g.year || "미상")).sort((a, b) => (b[0] === "미상" ? -1 : a[0] === "미상" ? 1 : +b[0] - +a[0])), famousFilter.year);
}

/** 필터에 맞는 기보의 famousAll() 위치 목록 (목록 순서 그대로). famous-review.js도 쓴다 */
function famousFilteredIndexes() {
  const hits = [];
  famousAll().forEach((g, idx) => {
    if (famousMatches(g)) hits.push(idx);
  });
  return hits;
}

/** 유명 기보 목록을 그립니다 (필터를 거친 앞 famousShown개). */
function renderFamousGames() {
  const list = document.getElementById("famous-games-list");
  if (!list) return;
  list.replaceChildren();
  const all = famousAll();
  const hits = famousFilteredIndexes();
  hits.slice(0, famousShown).forEach(idx => {
    const r = famousRow(all[idx]);
    const li = document.createElement("li");
    li.className = "famous-game-item";
    li.setAttribute("data-action", "loadFamousGame");
    li.setAttribute("data-index", String(idx));
    li.setAttribute("role", "button");
    li.tabIndex = 0;
    li.title = `${r.title}${r.year ? ` (${r.year})` : ""} · ${r.players} · ${r.moves}수 ${r.result}${r.opening ? `\n포진: ${r.opening}` : ""}\n출처: ${r.source}\n누르면 이 기보를 불러옵니다`;
    const title = document.createElement("span");
    title.className = "famous-game-title";
    title.textContent = famousTitleWithYear(r);
    const meta = document.createElement("span");
    meta.className = "famous-game-meta";
    meta.textContent = `${r.players} · ${r.moves}수 ${r.result}`;
    li.append(title, meta);
    if (typeof famousReviewBadge === "function") { // 검수 표시 (famous-review.js, 로컬 검수 때만)
      const badge = famousReviewBadge(all[idx]);
      if (badge) title.prepend(badge);
    }
    if (r.opening) {
      const op = document.createElement("span");
      op.className = "famous-game-opening";
      op.textContent = r.opening;
      li.appendChild(op);
    }
    list.appendChild(li);
  });
  if (!hits.length) {
    const empty = document.createElement("li");
    empty.className = "famous-games-empty";
    empty.textContent = "조건에 맞는 기보가 없습니다";
    list.appendChild(empty);
  }
  const status = document.getElementById("famous-filter-status");
  if (status) status.textContent = hits.length === all.length ? `${all.length}국` : `${hits.length} / ${all.length}국`;
  const more = document.getElementById("famous-more");
  if (more) {
    more.hidden = hits.length <= famousShown;
    more.textContent = `더 보기 (${Math.max(0, hits.length - famousShown)}국 남음)`;
  }
}

/** 검색어 칸 (대회명·대국자명) */
function setFamousQuery(value) {
  famousFilter.q = String(value || "").trim();
  famousShown = FAMOUS_PAGE;
  renderFamousGames();
}

/** 포진 고르기 */
function setFamousOpening(value) {
  famousFilter.opening = value || "";
  famousShown = FAMOUS_PAGE;
  renderFamousGames();
}

/** 연도 고르기 ("미상" = 연도 모름) */
function setFamousYear(value) {
  famousFilter.year = value || "";
  famousShown = FAMOUS_PAGE;
  renderFamousGames();
}

/** 필터 비우기 */
function resetFamousFilter() {
  famousFilter.q = "";
  famousFilter.opening = "";
  famousFilter.year = "";
  famousShown = FAMOUS_PAGE;
  const q = document.getElementById("famous-filter-q");
  if (q) q.value = "";
  famousFillFilterOptions();
  renderFamousGames();
}

/** 더 보기 */
function showMoreFamousGames() {
  famousShown += FAMOUS_PAGE;
  renderFamousGames();
}

/** data/famous-games.json을 읽어 목록에 붙인다. 없으면 조용히 내장 기보만 쓴다 */
async function loadFamousGameData() {
  if (!FAMOUS_DATA_ENABLED) return; // 파일이 아직 배포되지 않아 요청하면 콘솔에 오류 줄만 남는다
  try {
    const res = await fetch(FAMOUS_DATA_URL, { cache: "no-cache" });
    if (!res.ok) return;
    const data = await res.json();
    if (!data || !Array.isArray(data.games)) return;
    famousExtra = data.games.filter(g => g && g.m && Array.isArray(g.layout));
  } catch (e) {
    return; // 파일 없음, file:// 등
  }
  famousFillFilterOptions();
  renderFamousGames();
  if (typeof getSavedRecords === "function") syncRecordGroups(getSavedRecords().length);
  if (typeof famousReviewOnData === "function") famousReviewOnData(); // 검수 패널 보이기 (famous-review.js)
}

/**
 * 유명 기보 하나를 불러옵니다 (지금 판은 바뀐다).
 * @param {number} index - famousAll()에서의 위치
 */
function loadFamousGame(index) {
  const g = famousAll()[index];
  if (!g || typeof importRecordFromText !== "function") return;
  importRecordFromText(famousGameText(g));
  const r = famousRow(g);
  if (typeof showToast === "function") showToast(`${famousTitleWithYear(r)}을(를) 불러왔습니다`);
  if (typeof famousReviewShow === "function") famousReviewShow(Number(index)); // 포진 판정 검수 (famous-review.js)
}

document.addEventListener("DOMContentLoaded", () => {
  famousFillFilterOptions();
  renderFamousGames();
  ["mine", "famous"].forEach(group => {
    let collapsed = false;
    try {
      collapsed = localStorage.getItem(`recordGroupCollapsed_${group}`) === "1";
    } catch (e) {
      collapsed = false;
    }
    recordGroupSetCollapsed(group, collapsed);
  });
  if (typeof getSavedRecords === "function") syncRecordGroups(getSavedRecords().length);
  loadFamousGameData();
});
